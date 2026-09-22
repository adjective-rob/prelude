# CLAUDE.md

## What is this project?

Prelude is an open-source CLI tool and open standard for machine-readable codebase context. It analyzes a codebase and produces structured JSON files (`.context/` directory) that describe the project's stack, architecture, constraints, and decisions. These files are consumed by LLMs and AI agents to understand a codebase without manual explanation.

Published on npm as `prelude-context`. MIT licensed. Built by Adjective.

## Commands

```bash
pnpm build          # Compile TypeScript → dist/
pnpm test           # Run tests (vitest)
pnpm test:watch     # Run tests in watch mode
tsx bin/prelude.ts   # Run CLI in dev mode without building
```

## Architecture

```
bin/prelude.ts              CLI entry point (cac framework)
src/commands/               Command handlers (init, export, update, query, compact, decision, watch, share,
                            locate, annotate, diff, workspace, serve, mcp-config, validate)
src/core/                   Business logic
  infer.ts                  Static analysis — reads package.json, config files, directory structure
  source-scanner.ts         Source-level heuristics — reads actual code (regex, not AST); isTestFile()
  map-scanner.ts            buildMap(): exports, resolved imports (TS/JS, Python, Go, Rust), in-degree rank, modules, hubs
  vocab.ts                  Shared directory-name → purpose vocabulary (architecture.json and map.json)
  map-format.ts             Map filters and formatters shared by query, compact, export, CLAUDE.md/AGENTS.md
  map-annotate.ts           annotateModule(): manual module purpose/notes in map.json
  locate.ts                 Keyword scoring over map.json + decisions → the files to read for a task
  diff.ts                   computeDiff(): what prelude update would change; shared by update and diff
  decisions.ts              addDecision()/listDecisions() for decisions.json
  workspace.ts              User-level workspace registry and index (~/.prelude)
  query-engine.ts           Query/filter/format engine for prelude query and prelude compact
  exporter.ts               Markdown, JSON, CLAUDE.md, AGENTS.md export generation for prelude export
  merger.ts                 Smart merge — preserves manual edits during prelude update (incl. mergeMap)
  state-manager.ts          Tracks which fields are inferred vs manually edited
  compact.ts                Thin wrapper around query-engine's exportCompact
  updater.ts, watcher.ts    File change monitoring and incremental refresh for prelude watch
src/mcp/                    MCP server
  server.ts                 createPreludeServer(): tools and resources, single-project or workspace mode
  resolver.ts               Project resolution for tools (single root or workspace lookup)
  format-projects.ts        prelude_projects output
src/runtime/
  context.ts                resolveContextDir() — the only place that reads PRELUDE_ROOT
  home.ts                   resolvePreludeHome() — $PRELUDE_HOME or ~/.prelude
src/schema/                 Zod schemas defining the .context/ file types (incl. map.ts, workspace.ts)
schemas/                    JSON Schema files (published to adjective.us, used for validation)
src/utils/                  fs helpers, logging, timestamps, package version
src/constants.ts            File names, watch patterns, ignore patterns
```

## Key data flow

`prelude init` → `infer.ts` scans the project → writes `.context/*.json` files
`prelude update` → `infer.ts` re-scans → `merger.ts` diffs against existing → writes merged result
`prelude export` → `exporter.ts` reads `.context/*.json` → produces markdown/JSON → clipboard
`prelude query` → `query-engine.ts` reads `.context/*.json` → filters by topic/scope/type → stdout
`prelude compact` → `query-engine.ts` `exportCompact()` → token-budgeted one-liner-per-section → stdout
`prelude init` / `update` also → `map-scanner.ts` `buildMap()` → `merger.ts` `mergeMap()` → `.context/map.json`
`prelude locate` → `locate.ts` reads `map.json` + `decisions.json` + `architecture.json` → ranked files with reasons → stdout
`prelude diff` → `diff.ts` `computeDiff()` (same read/infer/merge as update, no writes) → drift → stdout / exit code
`prelude workspace` → `workspace.ts` → `~/.prelude/workspace.json` (registry) + `index.json` (generated) → `prelude serve --workspace`

## Conventions

- **ESM only.** `"type": "module"` in package.json. All imports use `.js` extensions even for `.ts` files.
- **TypeScript strict mode.** Target ES2022, bundler module resolution.
- **No runtime dependencies on heavy packages.** The scanner and inference use only `fs/promises`, `path`, and built-in Node.js modules. Regex heuristics, not AST parsers.
- **Schemas are the contract.** Every `.context/` file has both a Zod schema (`src/schema/`) and a JSON Schema (`schemas/`). Both must stay in sync. All JSON Schemas have `"additionalProperties": true` for forward compatibility.
- **Inference is best-effort.** Every scan/detection block is wrapped in try/catch. One unreadable file or failed heuristic must never crash the CLI. Return empty/skip gracefully.
- **Manual edits are sacred.** The `state-manager.ts` tracks which fields users edited by hand. `merger.ts` never overwrites manual fields during `prelude update`. This is a core design principle.
- **Output fields are omitted when empty.** Don't write empty arrays to `.context/` files. Check `.length > 0` before including a field. This keeps output clean for projects where a category doesn't apply.

## Schema changes

When adding new fields to the context format:
1. Add to the Zod schema in `src/schema/` (as `.optional()`)
2. Add to the matching JSON Schema in `schemas/` (not in `required`)
3. Add detection logic in `src/core/infer.ts` or `src/core/source-scanner.ts`
4. Add formatting in all three output paths: `exporter.ts` (markdown export), `query-engine.ts` `formatArchitectureSection` (query markdown), `query-engine.ts` `formatCompactArchitecture` (compact)
5. Add tests

For `map.json`, the Zod schema is `src/schema/map.ts` and the JSON Schema is `schemas/map.schema.json`; formatting lives in `src/core/map-format.ts` (not the architecture formatters). Anything a human can set (`purpose`, `notes`) must be preserved by `mergeMap`. Keep output deterministic: sorted arrays, no timestamps.

For the workspace, the Zod schema is `src/schema/workspace.ts` and the JSON Schema is `schemas/workspace.schema.json`. `index.json` is a machine-local cache. New index fields go in `IndexedProjectSchema` and `buildWorkspaceIndex()`, and show up in `src/mcp/format-projects.ts`.

## Testing

Tests live in `tests/`. Framework is Vitest. Run with `pnpm test`.

Tests that need filesystem fixtures should create temp directories in `os.tmpdir()` via `mkdtemp` and clean up in `afterAll`. Don't write test fixtures into the repo tree.

## Things to be careful about

- **Import extensions.** Always use `.js` in import paths, even when the source file is `.ts`. This is required by ESM + TypeScript's bundler resolution.
- **The `PRELUDE_ROOT` env var.** When set, Prelude reads/writes context to an external directory instead of `.context/` in the project. Several files have branching logic for this "external brain mode." Don't break it.
- **The compact format is agent-facing.** `prelude compact` output is optimized for token economy — one dense line per section. Agents parse this. Don't add verbose formatting or markdown to compact output.
- **`as any` casts in formatters.** The query-engine and exporter formatters cast Architecture to `any` to access source-level fields that aren't in the base Zod type's required fields. This is intentional — it avoids making the Zod type unwieldy while keeping JSON Schema validation correct.