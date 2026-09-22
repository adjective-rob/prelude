# Task 01: `src/core/map-scanner.ts` — build the routing map

## Goal

Create the module that reads a project's source files and produces a
`CodeMap`: modules, per-file exports, resolved internal imports, an in-degree
importance rank, the hub files an agent should read first, and which tests
cover which module. This is the foundation for `map.json` (Task 02),
`locate` (Task 04), and the workspace index (Task 07).

Also extract a shared directory-purpose vocabulary so `architecture.json` and
`map.json` agree on what a directory is for.

## Context

`src/core/source-scanner.ts` already walks source files (`collectSourceFiles`)
and reads the first 100 lines / 4 KB of each (`readFileHead`). That is enough
for its pattern detection but not for exports, which can be anywhere in a
file. This task needs its own reader (whole file, capped) and its own walker
(includes test files, flags them). Reuse the constants: export `SKIP_DIRS`
and `SOURCE_EXTENSIONS` from `source-scanner.ts` and import them.

`inferArchitecture()` in `src/core/infer.ts` guesses a directory purpose with
an `if/else if` chain on `dir.includes('components')` etc. It has no entry for
`core`, `commands`, `bin`, `mcp`, `cli`, `routes`, `models`, and many others,
which is why this repo's own `src/core` has no purpose. Move that vocabulary
to a new module and extend it.

Prior art worth knowing: Aider's repo map ranks files with PageRank over an
identifier graph. We deliberately use plain in-degree. It is deterministic,
explainable in one sentence, and good enough for routing.

## What to create

### `src/core/vocab.ts`

```ts
/** Last-path-segment → purpose. Checked exact first, then `includes` fallback. */
export const DIRECTORY_PURPOSES: Record<string, string> = {
  components: 'UI components',
  pages: 'Route pages',
  app: 'Application code',
  lib: 'Shared library code',
  utils: 'Utility functions',
  helpers: 'Utility functions',
  hooks: 'React hooks',
  context: 'React context',
  contexts: 'React context',
  providers: 'Context providers',
  store: 'State management',
  stores: 'State management',
  state: 'State management',
  api: 'API routes',
  routes: 'Route definitions',
  router: 'Route definitions',
  routers: 'Route definitions',
  controllers: 'Request handlers',
  handlers: 'Request handlers',
  services: 'Business logic services',
  core: 'Core business logic',
  domain: 'Domain logic',
  db: 'Database layer',
  database: 'Database layer',
  migrations: 'Database migrations',
  models: 'Data models',
  schema: 'Data schemas',
  schemas: 'Data schemas',
  types: 'Type definitions',
  config: 'Configuration',
  constants: 'Constants',
  public: 'Static assets',
  static: 'Static assets',
  assets: 'Static assets',
  styles: 'Stylesheets',
  tests: 'Tests',
  test: 'Tests',
  __tests__: 'Tests',
  spec: 'Tests',
  e2e: 'End-to-end tests',
  fixtures: 'Test fixtures',
  commands: 'Command handlers',
  cli: 'Command-line interface',
  bin: 'Executable entry points',
  mcp: 'MCP server',
  middleware: 'Middleware',
  workers: 'Background workers',
  jobs: 'Background jobs',
  tasks: 'Background jobs',
  scripts: 'Scripts',
  docs: 'Documentation',
  examples: 'Examples',
  templates: 'Templates',
  views: 'View templates',
  layouts: 'Layout components',
  features: 'Feature modules',
  modules: 'Feature modules',
  packages: 'Workspace packages',
  apps: 'Workspace applications',
  i18n: 'Internationalization',
  locales: 'Internationalization',
  auth: 'Authentication',
  agents: 'Agent implementations',
  pipelines: 'Pipeline stages',
  runtime: 'Runtime environment helpers',
};

export function inferDirectoryPurpose(dirPath: string): string | undefined
```

`inferDirectoryPurpose`: normalise separators to `/`, take the last segment,
lowercase. Exact key match wins. Otherwise, for each key, if the **last
segment** `includes(key)` and key length ≥ 3, return it (longest key first).
Otherwise `undefined`. Do not match against earlier segments; `src/app/utils`
is utilities, not application code.

In `inferArchitecture()`, replace the `if/else if` purpose chain with
`inferDirectoryPurpose(dir)`. Existing tests must still pass; if one asserted
the old `includes`-on-whole-path behaviour for a case the new function
handles differently, update the test and say so in the commit message.

### `src/core/map-scanner.ts`

```ts
import type { Architecture } from '../schema/index.js';

export type MapLang = 'ts' | 'js' | 'py' | 'go' | 'rs';

export interface MapFile {
  file: string;          // repo-relative, forward slashes
  lang: MapLang;
  lines: number;
  exports?: string[];    // ≤ 40, in order of first appearance, deduped
  imports?: string[];    // resolved internal targets only, sorted, deduped
  importedBy?: number;   // in-degree from non-test files; omitted when 0
  rank?: number;         // 0..1, two decimals; omitted when 0
  role?: string;         // from architecture.keyFiles / entryPoints when provided
  isTest?: boolean;      // omitted when false
}

export interface MapModule {
  path: string;          // directory, '.' for root-level files
  purpose?: string;
  notes?: string;        // never inferred; preserved by merger (Task 02)
  fileCount: number;
  truncated?: boolean;   // files[] was capped
  files: MapFile[];
  dependsOn?: string[];  // module paths, sorted
  dependedOnBy?: string[];
  tests?: string[];      // test files whose imports resolve into this module
}

export interface MapHub {
  file: string;
  importedBy: number;
  rank: number;
  exports?: string[];    // first 5
}

export interface CodeMap {
  $schema: string;       // `${SCHEMA_URL}/map.schema.json`
  version: string;       // '1.0.0'
  stats: {
    files: number;
    modules: number;
    edges: number;             // resolved import edges
    unresolvedImports: number; // internal-looking imports we could not resolve
    truncated?: boolean;       // file cap hit
  };
  modules: MapModule[];  // sorted by path
  hubs?: MapHub[];       // top 15 by importedBy desc, then path; omitted when empty
}

export interface BuildMapOptions {
  architecture?: Architecture;   // for role tagging and entry-point rank bonus
  maxFiles?: number;             // default 5000
  maxFileBytes?: number;         // default 512 * 1024
}

export async function buildMap(rootDir: string, opts?: BuildMapOptions): Promise<CodeMap>
```

Everything below is the required behaviour of `buildMap`.

#### 1. Walk

Own walker. Same skip rules as `collectSourceFiles` (`SKIP_DIRS`, dot-dirs,
`.egg-info`, depth ≤ 8) **but do not apply `IGNORE_PATTERNS`**, because that
list excludes `*.test.*` and we want tests. Only `SOURCE_EXTENSIONS`.
Stop after `maxFiles` and set `stats.truncated = true`. Sort the file list
before processing so output is deterministic regardless of `readdir` order.

Language from extension: `.ts/.tsx → ts`, `.js/.jsx/.mjs/.cjs → js`,
`.py → py`, `.go → go`, `.rs → rs`. Add `.mjs` and `.cjs` to
`SOURCE_EXTENSIONS` if absent.

Test detection (`isTest`), any of: path contains `/tests/`, `/test/`,
`/__tests__/`, `/spec/`, or starts with `tests/`, `test/`, `__tests__/`;
basename matches `\.(test|spec)\.[cm]?[jt]sx?$`, `^test_.*\.py$`,
`_test\.py$`, `^conftest\.py$`, `_test\.go$`. Rust: no file-level rule.

#### 2. Read

Read the whole file up to `maxFileBytes`; skip larger files entirely (they are
usually generated). Skip if the first 512 bytes contain `\0`. Count lines.
Wrap per-file work in try/catch; on error skip the file.

#### 3. Exports

Regexes run against the full content with the `gm` flags. Strip block
comments (`/\*[\s\S]*?\*/`) and line comments before matching for ts/js/go/rs;
strip `#` comments for py. Cap 40 per file, dedupe, keep first-seen order.

ts/js:
- `^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)`
- `^\s*export\s*\{([^}]*)\}` → split on commas, take the part after `as` if
  present, trim, drop `type` keyword prefix and empty strings.
- `^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$` → that name.
- `^\s*export\s+default\s+(?:function|class)\b` with no name → `default`.
- CommonJS: `module\.exports\s*=\s*\{([^}]*)\}` → names; `exports\.(\w+)\s*=` → name.

py: top-level only (line starts at column 0):
- `^(?:async\s+)?def\s+([A-Za-z_]\w*)` and `^class\s+([A-Za-z_]\w*)`.
- Skip names starting with `_` unless `__all__` lists them.
- If `__all__\s*=\s*\[([^\]]*)\]` exists, its names replace the list.

go: exported = capitalised.
- `^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)`
- `^type\s+([A-Z]\w*)`
- `^(?:var|const)\s+([A-Z]\w*)`
- grouped `var (`/`const (`/`type (` blocks: match `^\s+([A-Z]\w*)\s` inside them.

rs:
- `^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static|mod)\s+([A-Za-z_]\w*)`

#### 4. Imports and resolution

Collect import specifiers, then resolve each to a repo-relative file. Only
resolved internal targets are kept. Count unresolved specifiers that *looked*
internal (relative, alias, or package-root-prefixed) in
`stats.unresolvedImports`. Bare package imports (`react`, `fastapi`) are
ignored silently.

A helper `fileExists` cache (a `Set` of all walked files plus a
`Map<string, boolean>` for extra `stat` calls) keeps resolution fast. Prefer
checking membership in the walked set; fall back to `stat` only for
non-source targets like `index.json`.

ts/js specifiers, from `import ... from '<spec>'`, `import '<spec>'`,
`export ... from '<spec>'`, `require('<spec>')`, `import('<spec>')`:
- Relative (`./`, `../`): resolve against the importing file's directory.
  Strip a trailing `.js`/`.jsx`/`.mjs`/`.cjs` and try, in order:
  `<p>.ts`, `<p>.tsx`, `<p>.js`, `<p>.jsx`, `<p>.mts`, `<p>.cts`,
  `<p>/index.ts`, `<p>/index.tsx`, `<p>/index.js`, and the exact path if it has
  a known extension already.
- Alias: read `tsconfig.json` once (strip `//` and `/* */` comments before
  `JSON.parse`; on failure ignore). For each `compilerOptions.paths` entry
  `"<prefix>*": ["<target>*"]`, map specifiers starting with `<prefix>` to
  `<baseUrl or .>/<target><rest>` and resolve like a relative path from root.
  If there is no `paths` and the specifier starts with `@/` or `~/`, try
  `src/<rest>` then `<rest>`.
- Also `jsconfig.json` with the same rules if `tsconfig.json` is absent.

py specifiers, from `^\s*import\s+([\w.]+)` and `^\s*from\s+([\w.]+)\s+import`:
- Relative (`from .x`, `from ..x`): one `.` = importing file's dir, each extra
  `.` = one parent. Then module path segments join with `/`.
- Absolute (`app.routers.billing`): candidates, in order, for each root in
  `[rootDir, rootDir/src]` plus every top-level dir that contains an
  `__init__.py`: `<root>/<a/b/c>.py`, `<root>/<a/b/c>/__init__.py`. Also try
  dropping the last segment (`from app.routers import billing` where
  `billing` is a name, not a module): `<root>/<a/b>.py`, `<root>/<a/b>/__init__.py`.
  First hit wins.

go specifiers: parse `module <path>` from `go.mod` once. Import strings
(single or grouped `import ( ... )`) that start with `<module>/` resolve to the
directory `<rest>/`. Go edges are file → directory. Store the target with a
trailing slash in `imports`. Directory targets do not increment any file's
`importedBy`; they do contribute to module `dependsOn`/`dependedOnBy`.
Document this in the module's JSDoc.

rs specifiers:
- `^\s*(?:pub\s+)?mod\s+(\w+)\s*;` in a file `D/x.rs` or `D/mod.rs` or
  `src/main.rs` / `src/lib.rs`: try `D/<name>.rs`, `D/<name>/mod.rs`, and for
  `x.rs` also `D/x/<name>.rs`.
- `^\s*use\s+crate::([\w:]+)`: split on `::`, then walk from the longest
  prefix down: `src/<a/b/c>.rs`, `src/<a/b/c>/mod.rs`, then `src/<a/b>.rs`,
  `src/<a/b>/mod.rs`, then `src/<a>.rs`, `src/<a>/mod.rs`. First hit wins.
- `use super::` → resolve from parent module file (`D/mod.rs` or `D.rs`).

#### 5. Graph and rank

Build `importedBy[file]` counting only edges whose **source is not a test
file**. `maxIn = max(importedBy)`. For each file:
`rank = maxIn > 0 ? importedBy / maxIn : 0`. If the file appears in
`opts.architecture.entryPoints[].file` or `keyFiles[].file`, set
`rank = max(rank, 0.5)` and copy the `purpose`/`role` string into `role`.
Round to two decimals. Omit `rank` and `importedBy` when zero.

`hubs`: all files with `importedBy > 0`, sorted by `importedBy` desc then
`file` asc, first 15. Each with `exports` first 5.

#### 6. Modules

Module path = `dirname(file)` truncated to at most **3** segments. Root-level
files map to `.`. Group files, sort each group's `files` by path. `fileCount`
is the pre-cap count. If a module has more than 60 files, keep the 60 with the
highest `rank` (tiebreak path), sort those by path, and set `truncated: true`.

`purpose`: `inferDirectoryPurpose(path)`. If undefined, derive from exports of
the module's non-test files, using the first rule where ≥ 60% of exports
match (and there are ≥ 3 exports):

| pattern | purpose |
|---|---|
| `^register\w+Command$` | CLI command registrations |
| `Schema$` | Schema definitions |
| `^use[A-Z]` | React hooks |
| `(Provider|Context)$` | React context providers |
| `(Handler|Controller)$` | Request handlers |
| `(Service|Repository|Store)$` | Services |
| `^(get|list|find|create|update|delete|upsert)[A-Z]` | Data access functions |
| `^(test_|Test)` | Tests |

If nothing matches, omit `purpose`.

`dependsOn`: the set of *other* module paths that any non-test file in this
module imports from (file targets map to their module; directory targets map
to their truncated module path). `dependedOnBy` is the inverse. Sorted,
omitted when empty.

`tests`: for each test file, for each resolved import target, add the test
file to the target module's `tests`. Sorted, deduped, omitted when empty. Test
files still appear in their own module's `files` with `isTest: true`.

#### 7. Assemble

`modules` sorted by path. `stats.edges` = total resolved edges (including
from tests). Build the `$schema` URL from the same `SCHEMA_URL` constant the
other schema files use (`https://adjective.us/prelude/schemas/v1`).

Performance target: this repo (≈ 40 files) under 100 ms; a 5,000-file repo
under 3 s. Read files concurrently in batches of 32 with `Promise.all`; do
not open 5,000 file handles at once.

## Tests

`tests/map-scanner.test.ts`. Build fixtures in `mkdtemp` dirs. Assert on
exact expected structures where practical.

1. **TypeScript fixture**: `src/index.ts` imports `./core/a.js` and
   `@/utils/x.js`; `src/core/a.ts` imports `../utils/x.js` and exports
   `function alpha`, `const beta`, `export { gamma as delta }`;
   `src/utils/x.ts` exports `helper`; `tsconfig.json` with
   `paths: { "@/*": ["./src/*"] }`; `tests/a.test.ts` imports
   `../src/core/a.js`. Assert: exports of `a.ts` are
   `['alpha','beta','delta']`; `x.ts` has `importedBy: 2`, rank `1`;
   `hubs[0].file === 'src/utils/x.ts'`; module `src/core` has
   `dependsOn: ['src/utils']` and `tests: ['tests/a.test.ts']`;
   module `tests` file has `isTest: true`; test import did not count toward
   `importedBy` of `a.ts` (it should be 1, from index).
2. **Python fixture**: `app/__init__.py`, `app/main.py` with
   `from app.routers import billing` and `from .db import engine`;
   `app/routers/__init__.py`, `app/routers/billing.py` with `def checkout`,
   `class _Private`, `app/db.py`. Assert `main.py` imports resolve to
   `['app/db.py','app/routers/billing.py']`; `billing.py` exports
   `['checkout']`.
3. **Go fixture**: `go.mod` with `module example.com/svc`; `main.go` imports
   `example.com/svc/internal/api`; `internal/api/handler.go` with
   `func Serve()` and `func helper()`. Assert `main.go` imports
   `['internal/api/']`; exports of handler are `['Serve']`; module `.`
   dependsOn `['internal/api']`.
4. **Rust fixture**: `src/main.rs` with `mod util;` and
   `use crate::util::run;`; `src/util.rs` with `pub fn run()`. Assert import
   resolves to `src/util.rs`, export `['run']`.
5. **Limits**: a file with a null byte is skipped; a file larger than
   `maxFileBytes` (pass a small value) is skipped; `maxFiles: 2` sets
   `stats.truncated`.
6. **Vocab**: `inferDirectoryPurpose('src/core')` is `'Core business logic'`;
   `inferDirectoryPurpose('src/app/utils')` is `'Utility functions'`;
   `inferDirectoryPurpose('src/zzz')` is `undefined`.
7. **Determinism**: build the same fixture twice; `JSON.stringify` outputs are
   equal.

## Acceptance

- `buildMap(process.cwd())` on this repo: `hubs` contains `src/utils/fs.ts`
  and `src/constants.ts`; module `src/core` has `purpose: 'Core business logic'`
  and `dependsOn` includes `src/utils` and `src/schema`; module `tests` has
  `isTest` files; `src/core/query-engine.ts` appears in `tests` of no module
  but `src/core` has `tests` including `tests/query.test.ts`.
- `pnpm build && pnpm test` pass.
