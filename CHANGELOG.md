# Changelog

## 1.9.0 — 2026-09-22

Prelude now tells an agent *where to look*, not just what a project is, and serves every codebase on the machine from one MCP server.

### Added

- **`map.json`**: a committed, deterministic code map. Modules with purposes, per-file exports, resolved internal imports for TypeScript/JavaScript (including tsconfig `paths`), Python, Go, and Rust, in-degree rank, hub files, and the tests that cover each module. Written by `init`, merged by `update` and `watch`, validated by `validate`. Hand-edited module `purpose` and `notes` are never overwritten.
- **`prelude locate <query>`**: turns a task phrase into the handful of files to read, with the reason each was chosen. Keyword scoring over the map, roles, and decisions; no embeddings, no network.
- **`prelude annotate <module>`**: set a module's purpose or notes.
- **`prelude diff [--check]`**: shows what `update` would change without writing; `--check` exits 1 on drift for CI. The GitHub Action gains a `check` input (guard mode).
- **AGENTS.md export**: `prelude export --format agents-md`. CLAUDE.md and AGENTS.md exports now include a **Read first** list and a one-line-per-module map.
- **Workspace**: `prelude workspace add|remove|list|index|status` maintains `~/.prelude/workspace.json` and a generated `index.json` (override with `PRELUDE_HOME`). `project.json` gains `relatedProjects`; `shares-package` relations are inferred from manifests.
- **Workspace MCP server**: `prelude serve --workspace` serves every registered project; every tool takes an optional `project`. New tools: `prelude_projects`, `prelude_link_projects`, `prelude_workspace_refresh`. `prelude mcp-config --workspace` prints user-scope setup for Claude Code, Cursor, Codex, and Claude Desktop.
- **New MCP tools**: `prelude_locate`, `prelude_map`, `prelude_record_decision`, `prelude_annotate_module`, plus a `prelude://context/map` resource and server instructions.
- Node CLI entry points are detected from `package.json` `bin` and shebang files in `bin/`.
- `map` query type for `prelude query` and a `[map]` line in `prelude compact`.

### Fixed

- `PRELUDE_ROOT` (external brain mode) was ignored by `export`, `watch`, and parts of `update`; all context resolution now goes through one `resolveContextDir()`.
- `prelude init` printed debug lines.
- `init --force` no longer wipes `decisions.json`, `changelog.md`, or the project's `createdAt`.
- `update` no longer marks `createdAt`/`updatedAt` as manual edits (which froze `updatedAt`), and no longer re-infers `createdAt`.
- `update` now reports and writes changes to entry points, API endpoints, routes, and key files. Previously only directory changes counted.
- Test files were never excluded from source-level heuristics.
- FastAPI routes past the first 100 lines of a file were missed; `APIRouter(prefix=...)` is now applied.
- The MCP server reported version 1.5.0; it now reports the package version.
- `decisions.json` created by `prelude decision` used a wrong `$schema` URL.
