# Task 05: MCP tools — locate, map, and the write path

## Goal

Expose the new capabilities through the MCP server, and add the first write
tools so an agent can record what it learned. After this task an agent
connected to `prelude serve` can find files, inspect a module, record a
decision, and correct a module's purpose. Also stop hard-coding the server
version.

## Context

`src/mcp/server.ts` registers three tools (`prelude_query`,
`prelude_compact`, `prelude_status`) and three resources. Tools return
`{ content: [{ type: 'text', text }], _meta? }` and set `isError: true` on
failure. `tests/mcp-server.test.ts` drives it with `InMemoryTransport`.

`src/commands/decision.ts` builds a `Decision` (id from `generateId()`,
timestamp from `getCurrentTimestamp()`) and appends to `decisions.json`. Its
`$schema` URL is `https://prelude.dev/schemas/v1`, which is wrong; every
other file uses `https://adjective.us/prelude/schemas/v1`. Fix it while
extracting.

The server's `version` is the string `'1.5.0'`; the package is 1.8.x.
`bin/prelude.ts` already reads `package.json` with a dev/built fallback.

Tool descriptions are prompt text. They are the only thing that tells an
agent *when* to call a tool. Write them for that reader.

## What to change

### `src/utils/version.ts` (new)

`export function getPackageVersion(): string` using the same
`readFileSync` + fallback path trick as `bin/prelude.ts`. Use it in
`server.ts` and in `bin/prelude.ts` (replace the inline code).

### `src/core/decisions.ts` (new)

```ts
export interface DecisionInput {
  title: string; rationale: string;
  alternatives?: string[]; impact?: string; author?: string; tags?: string[];
  status?: Decision['status'];
}
export async function addDecision(contextDir: string, input: DecisionInput): Promise<Decision>
export async function listDecisions(contextDir: string): Promise<Decision[]>
```

`addDecision` creates `decisions.json` with the correct `$schema` if absent,
appends, writes, returns the decision. `src/commands/decision.ts` becomes a
thin wrapper that parses flags and calls it.

### `src/core/map-annotate.ts` (new)

```ts
export interface AnnotateInput { purpose?: string; notes?: string; clearNotes?: boolean }
export async function annotateModule(contextDir: string, modulePath: string, input: AnnotateInput): Promise<MapModule>
```

Normalise `modulePath` (strip `./` and trailing `/`). Throw with the list of
valid module paths if not found. Set fields, write `map.json`, then open a
`StateManager(contextDir)`, call `trackManual('map.json',
`modules.${path}.purpose`, purpose)` when purpose was given, and `save()`.
Notes need no state entry; the merger always preserves them.

Add CLI `prelude annotate <module> [--purpose <text>] [--notes <text>] [--clear-notes]`
in `src/commands/annotate.ts`; register in `bin/prelude.ts`. Print the
resulting module line.

### `src/mcp/server.ts`

New tools. Descriptions are given verbatim; use them.

**`prelude_locate`**
Description: "Find the files most relevant to a task before reading or
grepping. Give a short phrase describing what you need to change or
understand (e.g. 'billing checkout webhook', 'where manual edits are
preserved'). Returns ranked files with the reason each matched. Call this
first when you do not already know which file to open."
Params: `query: string`, `limit?: number` (default 8, max 25),
`scope?: string`, `include_tests?: boolean`.
Returns the CLI text format from Task 04 and `_meta: { hits }`.

**`prelude_map`**
Description: "Inspect the code map. With no arguments, returns the hub files
to read first and a one-line summary of every module. With `module`, returns
that module's purpose, notes, dependencies, tests, and files with exports.
With `file`, returns that file's exports, resolved imports, importers count,
and the module it belongs to."
Params: `module?: string`, `file?: string`, `max_tokens?: number` (default
1200). Uses the markdown formatter from Task 03 for the module view; for the
file view, a short markdown block. Truncate to budget with the existing
helper.

**`prelude_record_decision`**
Description: "Record an architectural decision in .context/decisions.json so
future sessions inherit it. Use this whenever you choose between
approaches, adopt or reject a library, or establish a convention. Keep the
title under 80 characters and put the reasoning in rationale."
Params: `title: string`, `rationale: string`, `alternatives?: string[]`,
`impact?: string`, `tags?: string[]`, `status?: enum` (default `accepted`).
Sets `author: 'agent'` unless the caller passes `author`. Returns the
decision as JSON.

**`prelude_annotate_module`**
Description: "Correct or enrich what the map says about a module. Set
`purpose` when the inferred purpose is wrong or missing; add `notes` for
anything a future agent should know about this directory (gotchas, entry
points, ownership). Manual purposes are never overwritten by prelude
update."
Params: `path: string`, `purpose?: string`, `notes?: string`. Returns the
module summary line.

Resources: add `prelude://context/map` (JSON). The `context-by-type` map
already gained `map` in Task 03; verify.

Also pass an `instructions` string to `new McpServer({...}, { instructions })`:

> Prelude serves committed context about this codebase. Recommended flow:
> call prelude_compact for an overview, prelude_locate to find the files for
> your task, then read those files. Record choices with
> prelude_record_decision and fix wrong module descriptions with
> prelude_annotate_module so the next session benefits.

Check the SDK version in `package.json` supports the `instructions` option
on `McpServer` (it is the second constructor argument, `ServerOptions`). If
it does not, skip and note it.

### `README.md`

Update the MCP tools table: seven tools, with one-line descriptions matching
the above. Add `prelude locate` and `prelude annotate` to the command
reference.

## Tests

Extend `tests/mcp-server.test.ts`. The fixture needs a `map.json` (reuse the
locate fixture shape) and an `architecture.json`.

1. `prelude_locate` with `query: 'mcp server'` returns text whose first
   numbered line names `src/mcp/server.ts`; `_meta.hits[0].file` matches.
2. `prelude_locate` with an empty query returns `isError: true`.
3. `prelude_map` no args → text contains `Read first` and every module path.
4. `prelude_map` with `module: 'src/core'` → contains that module's exports;
   with a bogus module → `isError` and the message lists valid paths.
5. `prelude_record_decision` writes a decision; reading `decisions.json`
   from the temp dir shows it with `author: 'agent'` and the adjective.us
   `$schema`.
6. `prelude_annotate_module` sets purpose; `.context/.prelude/state.json`
   marks it manual; a subsequent `mergeMap` with a different inferred
   purpose preserves it.
7. `tools/list` includes exactly the seven expected names.

Add `tests/decisions.test.ts`: `addDecision` on a dir with no
`decisions.json` creates it with the correct `$schema`.

## Acceptance

- `tsx bin/prelude.ts serve` starts; from Claude Code, `prelude_locate`
  works on this repo.
- `tsx bin/prelude.ts annotate src/core --notes "Regex heuristics only, no AST"`
  then `prelude update` keeps the note.
- `pnpm build && pnpm test` pass.
