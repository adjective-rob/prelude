# Task 04: `locate` — turn a task phrase into the files to read

## Goal

`prelude locate "billing checkout"` prints the handful of files most likely
relevant to that phrase, with the reason each was chosen. Pure keyword scoring
over `map.json`, plus `architecture.json` roles and `decisions.json` mentions.
No embeddings. Under 50 ms on a 5,000-file map.

## Context

`map.json` (Task 02) gives every file its exports, its module purpose, its
rank, and its role. `decisions.json` entries often name files in their
rationale. That is all the evidence we have and all we need for routing.

The output is read by agents more often than humans. Keep it short and
regular.

## What to create

### `src/core/locate.ts`

```ts
import type { CodeMap, Decisions, Architecture } from '../schema/index.js';

export interface LocateHit {
  file: string;
  module: string;
  purpose?: string;
  score: number;        // integer part from evidence, fractional part from rank
  rank?: number;
  exports?: string[];   // first 5
  reasons: string[];    // e.g. "export inferArchitecture", "path core", "role: CLI entry point"
}

export interface LocateOptions {
  limit?: number;       // default 8
  scope?: string;       // restrict to files under this directory
  includeTests?: boolean; // default: true only if the query mentions test/spec
}

export function tokenize(text: string): string[]
export function locateInMap(
  map: CodeMap,
  query: string,
  opts?: LocateOptions,
  extra?: { decisions?: Decisions; architecture?: Architecture }
): LocateHit[]
export async function locate(rootDir: string, query: string, opts?: LocateOptions): Promise<LocateHit[]>
```

`locate` loads the three files via `resolveContextDir(rootDir)` (missing
decisions/architecture are fine; missing map throws
`Error('map.json not found. Run `prelude update` to build it.')`).

#### Tokenisation

`tokenize(text)`:
1. Lowercase.
2. Split camelCase and PascalCase boundaries (`inferArchitecture` →
   `infer architecture`) and on every non-alphanumeric character.
3. Drop tokens shorter than 2 characters and these stopwords:
   `the a an to of in for on at is are be do does how where what which and
   or with that this it my our your i we you code file files function
   functions class method the`.
4. Naive singular: strip a trailing `s` from tokens of length ≥ 5 that do not
   end in `ss`.
5. Dedupe, keep order.

Index each file once per call: tokens of its path segments (with extension
stripped from the basename), tokens of each export (both the raw lowercased
export and its split tokens), tokens of `role`. Index each module once:
tokens of `purpose` and `notes`.

#### Scoring

For each non-test file (test files only when `includeTests`), for each query
token `t`:

| evidence | points | reason string |
|---|---|---|
| `t` equals a raw lowercased export | 5 | `export <Name>` |
| `t` equals a split token of an export | 3 | `export <Name>` |
| `t` is a substring (≥ 4 chars) of an export | 2 | `export <Name>` |
| `t` equals the file basename (ext stripped) | 4 | `file <basename>` |
| `t` equals a directory segment of the path | 3 | `path <segment>` |
| `t` is a substring (≥ 4 chars) of the basename | 2 | `file <basename>` |
| `t` in the file's `role` | 3 | `role: <role>` |
| `t` in module `purpose` or `notes` | 2 | `module: <purpose>` |
| a decision whose title/rationale/tags contain `t` also mentions this file path | 2 | `decision: <title>` |

Each reason string appears once per file even if several tokens hit it.
After summing: if **every** query token contributed at least one point,
add 3 (`reason: "matches all terms"`). Then add `rank` (0..1) as a
tie-breaker so the score's fractional part carries importance. Files with a
zero integer score are dropped.

Sort by score desc, then `importedBy` desc, then path. Return the first
`limit`.

If `opts.scope` is set, only files whose path starts with the normalised
scope are candidates.

#### Empty result

Return `[]`. The CLI (below) prints the hubs as a fallback so the agent still
gets somewhere to start.

### `src/commands/locate.ts` (new) and `bin/prelude.ts`

```
prelude locate <query...> [--limit <n>] [--scope <dir>] [--tests] [--format text|json] [--root <path>]
```

`<query...>` joins all positional words so quoting is optional. Register in
`bin/prelude.ts`.

Text format, one hit per line, numbered:

```
1. src/core/merger.ts  ·  src/core (Core business logic)  ·  score 14
   exports: ContextMerger, MergeResult, MergeChange
   why: export ContextMerger, path core, decision: Manual edits are sacred, matches all terms
2. src/core/state-manager.ts  ·  src/core (Core business logic)  ·  score 11
   ...
```

When empty:

```
No matches for "…". Start with the hubs:
  src/utils/fs.ts (imported by 12)
  src/constants.ts (imported by 9)
```

JSON format: `JSON.stringify(hits, null, 2)`.

Exit code 0 even when empty. Error (exit 1) only when `map.json` is missing.

## Tests

`tests/locate.test.ts` with an in-memory `CodeMap` fixture modelled on this
repo (modules `src/core`, `src/commands`, `src/mcp`, `src/utils`, `tests`;
files with realistic exports and ranks) plus a `Decisions` fixture with one
entry whose rationale mentions `src/core/merger.ts`.

1. `tokenize('How does inferArchitecture handle the tests?')` equals
   `['infer','architecture','handle','test']`.
2. `"architecture inference"` → first hit `src/core/infer.ts`, reasons
   include `export inferArchitecture`.
3. `"mcp server tools"` → first hit `src/mcp/server.ts`.
4. `"preserve manual edits during update"` → `src/core/merger.ts` and
   `src/core/state-manager.ts` both in the top 3; merger's reasons include
   the decision title.
5. `"query engine tests"` → includes `tests/query.test.ts` (test files
   admitted because the query mentions tests); the same query without
   `tests` excludes it.
6. `scope: 'src/commands'` excludes `src/core` files.
7. `"zzzz qqqq"` → `[]`.
8. Ties are broken by rank: two files with identical evidence, the higher
   rank comes first.

## Acceptance

- `tsx bin/prelude.ts locate preserve manual edits during update` on this
  repo lists `merger.ts` and `state-manager.ts` in the top three.
- `tsx bin/prelude.ts locate mcp server tools` lists `src/mcp/server.ts`
  first.
- `pnpm build && pnpm test` pass.
