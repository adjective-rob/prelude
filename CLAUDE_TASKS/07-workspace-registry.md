# Task 07: Workspace registry — many projects, one index

## Goal

A user-level registry of projects and a generated index over their context
files. This is what lets one MCP server (Task 08) answer questions about any
registered codebase. Also add `relatedProjects` to `project.json` so the
relationships between codebases become part of the standard.

## Context

Two modes exist today: embedded (`.context/` in the repo) and external brain
(`PRELUDE_ROOT/<basename>/`). Both are per-project. There is no notion of
"all my projects". `PRELUDE_ROOT` stays as is; the workspace is a separate,
user-level concept.

`project.json` schema is in `src/schema/project.ts`; `mergeProject` in
`merger.ts` has a `preserveFields` list (`name`, `description`, `team`,
`goals`) that survives re-inference.

Package names: JS `package.json` `name`; Python `pyproject.toml`
`[project].name` (parse with the existing `parsePyprojectToml` in
`infer.ts`; export it); Go `go.mod` `module`; Rust `Cargo.toml`
`[package].name`. `stack.json` may record dependencies; check what
`inferStack` writes (`dependencies` map or array) before relying on it.

## What to create

### `src/runtime/home.ts`

```ts
export function resolvePreludeHome(): string   // $PRELUDE_HOME || ~/.prelude
export function workspaceFilePath(): string    // <home>/workspace.json
export function workspaceIndexPath(): string   // <home>/index.json
```

Use `os.homedir()`. Create the directory lazily on write, never on read.

### `src/schema/workspace.ts` and `schemas/workspace.schema.json`

```ts
export const WorkspaceProjectSchema = z.object({
  name: z.string(),
  path: z.string(),                 // absolute
  alias: z.string().optional(),
  addedAt: z.string().datetime(),
});
export const WorkspaceSchema = z.object({
  $schema, version,
  projects: z.array(WorkspaceProjectSchema),
});

export const IndexedProjectSchema = z.object({
  name: z.string(),
  alias: z.string().optional(),
  path: z.string(),
  contextDir: z.string(),
  description: z.string().optional(),
  type: z.string().optional(),            // architecture.type
  language: z.string().optional(),
  frameworks: z.array(z.string()).optional(),
  packageName: z.string().optional(),
  entryPoints: z.array(z.object({ file: z.string(), purpose: z.string() })).optional(),
  apiEndpoints: z.array(z.object({ path: z.string(), methods: z.array(z.string()), file: z.string() })).optional(), // first 40
  hubs: z.array(z.object({ file: z.string(), importedBy: z.number() })).optional(), // first 5
  modules: z.array(z.object({ path: z.string(), purpose: z.string().optional() })).optional(), // all, purpose only
  relatedProjects: z.array(RelatedProjectSchema).optional(),
  decisionCount: z.number().optional(),
  lastContextUpdate: z.string().optional(), // project.updatedAt
  hasMap: z.boolean(),
  missing: z.boolean().optional(),          // path or context dir no longer exists
});
export const WorkspaceIndexSchema = z.object({
  $schema, version,
  generatedAt: z.string().datetime(),
  projects: z.array(IndexedProjectSchema),
});
```

`index.json` is a cache, not a committed artifact, so a timestamp is fine
here.

### `relatedProjects` on `project.json`

In `src/schema/project.ts`:

```ts
export const RelatedProjectSchema = z.object({
  name: z.string(),                         // workspace project name or alias
  relation: z.enum(['consumes', 'provides', 'shares-package', 'sibling', 'other']),
  contract: z.string().optional(),          // e.g. "REST /api/v1, Supabase JWT bearer"
  notes: z.string().optional(),
});
// on ProjectSchema:
relatedProjects: z.array(RelatedProjectSchema).optional(),
```

Mirror in `schemas/project.schema.json`. Add `relatedProjects` to
`mergeProject`'s `preserveFields`. Document in `spec.md` §4.2 with the
relation vocabulary: `consumes` (this project calls the other),
`provides` (the other calls this), `shares-package` (imports it as a
dependency), `sibling` (same product, no direct coupling), `other`.

### `src/core/workspace.ts`

```ts
export async function loadWorkspace(): Promise<Workspace>          // empty if missing
export async function saveWorkspace(ws: Workspace): Promise<void>
export async function addProject(path: string, alias?: string): Promise<WorkspaceProject>
export async function removeProject(nameOrPathOrAlias: string): Promise<boolean>
export function findProject(ws: Workspace, key: string): WorkspaceProject | undefined
export async function buildWorkspaceIndex(ws?: Workspace): Promise<WorkspaceIndex>
export async function saveWorkspaceIndex(index: WorkspaceIndex): Promise<void>
export async function loadWorkspaceIndex(): Promise<WorkspaceIndex | undefined>
```

- `addProject`: resolve to absolute; require `resolveContextDir(path)` to
  exist (error: "No context found at <dir>. Run `prelude init` in that
  project first."). Name = `project.json.name` if readable, else basename.
  If a project with the same absolute path exists, update its alias and
  return it. If the *name* collides with a different path, require an alias
  (error explains).
- `findProject`: match `alias`, then `name`, then `basename(path)`, then
  exact path, all case-insensitive.
- `buildWorkspaceIndex`: for each project, read `project.json`,
  `stack.json`, `architecture.json`, `map.json`, `decisions.json`
  tolerantly. Read the package name from the manifest in `path` (see
  Context). Fill `IndexedProject`. Then infer relations: for each pair
  `(A, B)` where A's dependency names (from `package.json`
  `dependencies`/`devDependencies`, `pyproject` dependencies, `go.mod`
  requires, `Cargo.toml` dependencies) include B's `packageName`, add
  `{ name: B.name, relation: 'shares-package' }` to A's
  `relatedProjects` **in the index only** unless A's `project.json` already
  lists B. Manual relations from `project.json` come first.
- Projects whose path or context dir is gone get `missing: true` and are
  kept (so `list` can show them and `remove` can clean up).

### `src/commands/workspace.ts` and `bin/prelude.ts`

```
prelude workspace add <path> [--alias <name>]
prelude workspace remove <name|alias|path>
prelude workspace list
prelude workspace index
prelude workspace status
```

- `add`: registers, then rebuilds and saves the index, prints the project
  line and the hint `Serve it: prelude serve --workspace`.
- `list`: one line per project: `name (alias)  path  · type · language ·
  N modules · N endpoints · MISSING` as applicable. Reads the index; if
  absent, builds it.
- `index`: rebuilds, prints counts and the index path.
- `status`: home path, file paths, project count, index age.

cac supports `workspace add <path>` as a literal subcommand name; register
each as its own `cli.command('workspace add <path>', …)`.

`prelude init` and `prelude update` end with a hint line when the project is
not in the workspace: `Tip: prelude workspace add . — makes this project
available to prelude serve --workspace`. Detect by loading the workspace and
`findProject` on the absolute root; never auto-add.

## Tests

`tests/workspace.test.ts`. Set `process.env.PRELUDE_HOME` to a `mkdtemp`
dir in `beforeAll`, restore in `afterAll`. Create two fixture projects with
`.context/` (reuse the fixtures from `tests/mcp-server.test.ts` and
`tests/locate.test.ts`), plus `package.json` in each; project B's name is
`@acme/api` and A depends on it.

1. `addProject(A)` then `loadWorkspace()` has one project with the name
   from `project.json`.
2. `addProject(A)` again with an alias updates in place; length stays 1.
3. `addProject(dirWithoutContext)` throws with the "Run prelude init" message.
4. `buildWorkspaceIndex()` after adding A and B: B has `hasMap`,
   `apiEndpoints` from its architecture fixture; A's `relatedProjects`
   includes `{ name: <B name>, relation: 'shares-package' }`.
5. A's `project.json` lists B as `consumes` with a contract → the index
   shows the manual entry first and no duplicate `shares-package` for B.
6. Delete B's directory; `buildWorkspaceIndex()` marks it `missing`;
   `removeProject('B')` returns true and it is gone.
7. `findProject` matches alias, name, basename, path, case-insensitively.

## Acceptance

- `prelude workspace add .` in this repo, then `prelude workspace list`
  shows `prelude-context` with module and hub counts.
- `pnpm build && pnpm test` pass.
