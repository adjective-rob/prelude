# Task 08: `prelude serve --workspace` — one server for every project

## Goal

The developer registers Prelude once, at user scope, in their agent harness.
From then on every session on the machine can list their projects, get a
compact overview of any of them, locate files inside any of them, and write
decisions and cross-project links back. This is the product.

## Context

`createPreludeServer(rootDir)` in `src/mcp/server.ts` binds every tool to a
single root at construction time. `prelude serve --root` picks that root.
`prelude mcp-config` prints per-project registration snippets.

Task 07 provides `loadWorkspace`, `findProject`, `loadWorkspaceIndex`,
`buildWorkspaceIndex`. Task 05 provides the single-project tools.

Claude Code registers user-scope servers with
`claude mcp add --scope user <name> -- <command> [args]`. Cursor reads
`~/.cursor/mcp.json`. Codex reads `~/.codex/config.toml` with a
`[mcp_servers.<name>]` table (`command`, `args`, `env`). Claude Desktop
reads `claude_desktop_config.json`.

## What to change

### `src/mcp/server.ts` — project resolution

```ts
export interface ServerOptions {
  rootDir?: string;      // single-project mode
  workspace?: boolean;   // workspace mode
}
export function createPreludeServer(options: ServerOptions | string): McpServer
```

Accept a string for backward compatibility (existing tests pass a string).

Internal:

```ts
interface ResolvedProject { name: string; rootDir: string; contextDir: string }
interface ProjectResolver {
  mode: 'single' | 'workspace';
  resolve(project?: string): Promise<ResolvedProject>;
  list(): Promise<ResolvedProject[]>;
}
```

- Single mode: `resolve()` ignores `project` and returns the root.
- Workspace mode: loads the workspace on each call (cheap; the file is
  small, and it means `prelude workspace add` in another terminal is
  visible without restarting the server). `resolve(undefined)`: if exactly
  one project is registered, use it; otherwise throw
  `Error('Specify project. Registered: a, b, c')`. `resolve(key)` uses
  `findProject`; unknown key throws with the same list. Projects marked
  missing throw `Error('Project <name> path no longer exists: <path>')`.

Every existing and Task 05 tool gains an optional `project: z.string()`
param with the description: "Project name or alias from prelude_projects.
Required in workspace mode when more than one project is registered;
ignored in single-project mode." Each handler starts with
`const p = await resolver.resolve(project)` and uses `p.rootDir` /
`p.contextDir`. Wrap in the existing try/catch so resolver errors come back
as `isError` text, not exceptions.

### New tools (workspace mode only; in single mode do not register them)

**`prelude_projects`**
Description: "List every project registered in this workspace with its
purpose, stack, entry points, API surface, hub files, and relationships to
other projects. Call this first in any session that may touch more than one
codebase, then use the returned name as the `project` argument on other
tools."
Params: `refresh?: boolean` (rebuild the index first; default false, but
rebuild automatically if `index.json` is missing or older than the
workspace file).
Returns markdown, one block per project:

```
### backend  (~/code/backend)
FastAPI backend for X. · backend · Python · FastAPI, SQLAlchemy
Entry: app/main.py (application entry)
API: 42 endpoints under /api/v1 (GET /api/v1/stats, POST /api/v1/feedback, +40)
Read first: app/db.py (31), app/deps.py (18), app/models.py (12)
Modules: app/routers (Route definitions), app/services (Business logic services), app/models (Data models) +6
Related: provides → frontend (REST /api/v1, JWT bearer)
Decisions: 7 · context updated 2026-09-20
```

Missing projects get one line: `### name — MISSING (path)`. Target ≤ 150
tokens per project; truncate module lists at 8 and endpoint samples at 3.

**`prelude_locate`** in workspace mode: when `project` is omitted, run
`locateInMap` against every project that has a map, prefix each hit's file
with `<name>:`, merge, sort by score, and return `limit` overall. The
`_meta.hits` entries gain a `project` field.

**`prelude_link_projects`**
Description: "Record how two projects relate so future sessions know the
contract between them. Writes to the `from` project's project.json.
Example: from=frontend, to=backend, relation=consumes, contract='REST
/api/v1 with Supabase JWT bearer; see backend CLAUDE.md for routes'."
Params: `from: string`, `to: string`, `relation: enum` (from the schema),
`contract?: string`, `notes?: string`. Resolves both names, upserts the
entry in `from`'s `project.json` `relatedProjects` (match on `name`),
marks the field manual in state, rebuilds the index, returns the entry.

**`prelude_workspace_refresh`**
Description: "Rebuild the workspace index after adding projects or running
prelude update in one of them."
Params: none. Returns counts.

### Resources

Workspace mode adds `prelude://workspace/index` (JSON) and a template
`prelude://workspace/{project}/compact` (text, the compact output for that
project). Single-mode resources are unchanged.

### Server `instructions`

Workspace mode text:

> Prelude serves committed context for several codebases on this machine.
> Start with prelude_projects to see what exists and how projects relate.
> Then prelude_compact(project) for an overview and prelude_locate(query,
> project) to find files before reading. Record choices with
> prelude_record_decision and cross-project contracts with
> prelude_link_projects.

### `src/commands/serve.ts`

`--workspace` flag. In workspace mode skip the `.context/` existence check;
instead load the workspace and exit 1 with
`No projects registered. Run \`prelude workspace add <path>\`.` when empty.
stderr line: `Prelude MCP server started (workspace, N projects)`.

### `src/commands/mcp-config.ts`

`--workspace` flag. Output per client:

- `claude-code`: `claude mcp add --scope user prelude -- <bin> serve --workspace`
  plus the JSON for `~/.claude.json`-style `mcpServers`.
- `cursor`: JSON for `~/.cursor/mcp.json`.
- `codex`: TOML for `~/.codex/config.toml`:
  ```toml
  [mcp_servers.prelude]
  command = "<bin>"
  args = ["serve", "--workspace"]
  ```
- `claude-desktop`: JSON as today.

If `PRELUDE_HOME` is set in the current environment, include it under `env`
in every snippet so the server sees the same registry. Server name is
`prelude` in workspace mode and stays `prelude-context` in per-project
mode. Mention in the printed text that the user-scope registration means
"available in every session on this machine".

### `README.md`

New section directly after the intro, before per-project setup:
"Multi-project workspace" with the four-command flow from
`CLAUDE_TASKS/README.md` and the tool table. Move per-project MCP setup
under it as "Single project".

## Tests

`tests/mcp-workspace.test.ts`: `PRELUDE_HOME` → temp dir; two fixture
projects `alpha` (TS, with map and decisions) and `beta` (Python, with
`apiEndpoints` in architecture and a map); `addProject` both;
`createPreludeServer({ workspace: true })` over `InMemoryTransport`.

1. `tools/list` includes `prelude_projects`, `prelude_link_projects`,
   `prelude_workspace_refresh`, and every single-project tool.
2. `prelude_projects` text contains both names, beta's endpoint count, and
   alpha's hub file.
3. `prelude_compact` without `project` → `isError` listing both names.
4. `prelude_compact` with `project: 'beta'` → contains beta's stack line.
5. `prelude_locate` with `project: 'alpha'` → alpha files only;
   without `project` → hits carry `project` and the top hit is the best
   across both.
6. `prelude_record_decision` with `project: 'beta'` writes into beta's
   `.context/decisions.json`, not alpha's.
7. `prelude_link_projects` from alpha to beta → alpha's `project.json`
   has the entry; `prelude_projects` now shows `Related: consumes → beta`.
8. Unknown project name → `isError` with the registered list.
9. Single-mode server created with a string still passes the old tests
   unchanged.

## Acceptance

- `prelude workspace add` this repo and one other project;
  `prelude mcp-config --workspace --client claude-code`; run the printed
  command; open a new Claude Code session in an unrelated directory and
  call `prelude_projects`. Both projects appear.
- `pnpm build && pnpm test` pass.
