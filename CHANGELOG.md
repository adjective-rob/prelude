# Changelog

## 1.11.0 — 2026-10-04

### Added

- Scanning honours the project's root `.gitignore`: ignored files and directories no longer appear in `map.json` or `architecture.json`. Projects that had ignored source directories on disk will see them drop out on the next `prelude update`.

### Fixed

- `prelude update` no longer rewrites `state.json` timestamps (or anything else) when there is nothing to update.
- A published Node package with `exports` and no `bin` is classified as `library` even when its source has a `pages/` or `app/` directory. Previously a web framework such as hono came out as `frontend`.
- Author metadata corrected.

## 1.10.0 — 2026-10-04

`locate` now finds files at least as well as a ranked grep, and returns what grep cannot.

### Added

- Every `locate` result carries the context around the file: the tests that import it (or the module's tests), the titles of recorded decisions that mention it, and the module's notes. Text output gains `impact`, `decisions`, and `notes` lines; JSON output and the MCP `_meta.hits` gain `tests`, `decisions`, and `notes` fields. Empty fields are omitted.

### Changed

- `prelude locate` and `prelude_locate` now also search file contents for the query terms and blend that with the map evidence, weighting rare terms higher. Results gain a `content term×count` reason. On the git-history benchmark (`bench/locate-bench.ts`, six repositories) hit@8 rises from 55% to 87% on average, against 82% for a ranked grep.
- MCP server instructions and the `prelude_locate` description tell agents to run the listed tests and respect the listed decisions.
- README leads with what a text search cannot tell an agent, and reports the benchmark.

## 1.9.1 — 2026-10-04

### Added

- MCP tool annotations: the read tools (`prelude_compact`, `prelude_locate`, `prelude_map`, `prelude_query`, `prelude_status`, `prelude_projects`) declare `readOnlyHint`, and the write tools declare that they are non-destructive, so clients can skip or soften approval prompts.
- `mcpName` in `package.json` and a `server.json` for the MCP registry.
- `LICENSE` file (MIT). The package declared MIT but shipped no license text.
- CI workflow: lint, build, and tests on Node 20, 22, and 24.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and `schemas/README.md`.
- `bench/locate-bench.ts`: replays a repository's git history as a retrieval task to measure `prelude locate` against a ranked-grep baseline.
- The GitHub Action can be pinned as `adjective-rob/prelude@v1`.

### Fixed

- Removed unused code flagged by lint; CI is warning-free.
- Status lines printed two symbols: one from `log-symbols` and one from the message text (`✔ ✓ Created .context/`, `ℹ ℹ️  Run \`prelude export\``). The logger already prefixes every level with a glyph, so the redundant glyph is gone from all 36 affected messages across `init`, `update`, `export`, `share`, `watch`, `workspace`, and `decision`.
- The GitHub Action and this repo's update workflow no longer open a pull request when the only change is refreshed timestamps in `.context/.prelude/state.json`.
- `prelude diff` no longer reports a `hubs` change whose `Old` and `New` lists are identical. The hub comparison reads the full list but the change record truncated both to the first five files, so a change below the fifth hub was reported without showing what changed.

### Changed

- README rewritten around the code map, `locate`, the MCP workspace, and CI drift checks. Fixed dead links and the stated Node.js requirement (>= 20.19).

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
