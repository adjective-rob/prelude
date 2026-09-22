# Task 03: Show the map everywhere — query, compact, export, CLAUDE.md, AGENTS.md

## Goal

Make `map.json` visible through every output path, then add `AGENTS.md` as an
export format. After this task, `prelude compact` has a `[map]` line,
`prelude query --type map` works, `prelude export --format claude-md` writes a
real architecture section built from the map, and
`prelude export --format agents-md` exists.

## Context

Per `CLAUDE.md`, a new field needs formatting in three places:
`exporter.ts` (markdown export), `query-engine.ts` `formatArchitectureSection`
(query markdown), and `formatCompactArchitecture` (compact). The map is a new
**file**, not a field, so it gets its own section formatters rather than
being folded into architecture.

`query-engine.ts`: `ContextType`, `VALID_TYPES`, `ContextData`, `loadContext`,
`extractMatchingFields` (deep keyword match), `filterArchitectureByScope`,
`formatAsMarkdown`, `formatCompactSection`, `exportCompact`. Compact output is
truncated from the tail when over budget, so section order is priority order.

`exporter.ts`: `exportToMarkdown`, `exportToJSON`, `exportToClaudeMd`,
`saveExport(rootDir, format)`. `src/commands/export.ts` validates the format
list and labels.

The compact format is agent-facing: one dense line per section, no markdown.

## What to change

### `src/core/query-engine.ts`

1. `ContextType` gains `'map'`. `VALID_TYPES` becomes
   `['project','stack','architecture','constraints','decisions','map']`.
   The map goes last on purpose: compact output is truncated from the tail
   under a token budget, the map is the largest section, and it is the one
   that degrades most gracefully when cut. Constraints are rules the agent
   must obey and must never be the section that gets dropped.
2. `ContextData` gains `map?: CodeMap`; `loadContext` loads
   `CONTEXT_FILES.MAP`.
3. Topic filtering for the map must not use `extractMatchingFields` (a hit
   anywhere returns the entire `modules` array). Add:

   ```ts
   function filterMapByTopic(map: CodeMap, topic: string): CodeMap | undefined
   ```
   A module matches if its `path`, `purpose`, or `notes` contains the topic.
   A file matches if its `file`, `role`, or any export contains the topic
   (case-insensitive). Keep modules that match or that contain a matching
   file. In a kept module, keep matching files; if the module itself matched
   but no files did, keep its top 5 files by rank. Recompute `fileCount` as
   the kept count. Filter `hubs` to matching files. Return `undefined` when
   nothing matched.
4. Scope filtering: `filterMapByScope(map, scope)` keeps modules where
   `module.path` starts with the normalised scope or vice versa. Same
   normalisation as `filterArchitectureByScope`. Filter `hubs` to files under
   the scope.
5. Wire both into `executeQuery` and `exportCompact` where the
   `architecture`/`constraints` scope branches are.
6. `formatMapSection(map)` for markdown:

   ```
   ## Code Map

   **Read first:**
   - `src/utils/fs.ts` — imported by 12 · readJSON, writeJSON, fileExists
   - ...                                          (hubs, max 8)

   ### `src/core` — Core business logic
   _notes, if any_
   Depends on: src/utils, src/schema · Used by: src/commands, src/mcp
   Tests: tests/query.test.ts, tests/merge-preserve.test.ts
   - `infer.ts` (rank 0.4, 1702 lines) — inferStack, inferArchitecture, +2
   - ...                                          (top 10 files by rank, then path)
   ```
   File names inside a module section are shown relative to the module path.
   Exports show the first 4 then `+N`. Omit any line whose data is absent.
7. `formatCompactMap(map)`:

   ```
   [map] hubs: src/utils/fs.ts(12), src/constants.ts(9), src/core/query-engine.ts(4) | src/core (Core business logic): infer.ts, query-engine.ts, merger.ts +7 | src/commands (Command handlers): init.ts, update.ts +9 | ...
   ```
   Hubs: top 5 with in-degree in parens. Modules in path order, each with
   purpose in parens if present, then its top 3 files by rank (basename
   relative to the module), then `+N` for the rest. Skip modules whose only
   files are tests unless the topic mentions `test`. One line, no newlines.
8. `formatCompactSection` gets `case 'map'`.

### `src/core/exporter.ts`

1. `exportToMarkdown`: after the architecture section, if `map.json` exists,
   append `## 🗺️ Code Map` using the same body as `formatMapSection` (share
   the function: export it from `query-engine.ts` or move both map
   formatters into a new `src/core/map-format.ts` and import from both
   places; prefer the new module).
2. `exportToJSON`: include `map` when present.
3. `exportToClaudeMd`: when the map exists, replace the `**Key Directories:**`
   block with:

   ```
   **Read first:** `src/utils/fs.ts`, `src/constants.ts`, `src/core/query-engine.ts`

   **Modules:**
   - `src/core/` — Core business logic. Key files: infer.ts (inferStack, inferArchitecture), query-engine.ts (executeQuery, exportCompact), merger.ts
   - `src/commands/` — Command handlers. Key files: init.ts, update.ts, export.ts
   ```
   Key files = top 3 by rank; show up to 2 exports each in parens. Keep the
   existing entry points, API endpoints, and key files blocks. When the map
   is absent, behaviour is unchanged.
4. New `exportToAgentsMd(rootDir)`: same body as `exportToClaudeMd` with the
   heading `# AGENTS.md` and a second line
   `> Generated by Prelude from .context/. Run \`prelude update\` to refresh.`.
   Factor the shared body into a private `buildAgentGuide(rootDir, title)`.
5. `saveExport` accepts `'agents-md'`; it writes `AGENTS.md` to the same
   target directory the `claude-md` format uses today (check, do not assume)
   and returns the path.

### `src/commands/export.ts`

Add `agents-md` to `validFormats`, the help string, and the label map
(`AGENTS.md`).

### `src/commands/query.ts` and `src/commands/compact.ts`

If either validates `--type` against a hard-coded list, add `map`. If they
use `VALID_TYPES`, nothing to do.

### `src/mcp/server.ts`

The `context-by-type` resource's `fileMap` gains `map`. The
`prelude_query` `type` enum is built from `VALID_TYPES`, so it updates
itself. Full tool work is Task 05.

## Tests

- `tests/query.test.ts`: add a `map` fixture. Assert `executeQuery` with
  `type: 'map'` returns the section; `topic: 'merge'` returns only the module
  and file containing `merger`; `scope: 'src/core'` drops other modules;
  compact output contains a single line starting with `[map] hubs:`.
- `tests/export-formats.test.ts`: `agents-md` writes `AGENTS.md` starting
  with `# AGENTS.md`; `claude-md` output contains `**Read first:**` when a
  map exists and `**Key Directories:**` when it does not.
- Compact line for a fixture with a tests-only module omits that module.

## Acceptance

- `tsx bin/prelude.ts compact` on this repo prints a `[map]` line naming
  `src/core` and `src/commands` with their purposes.
- `tsx bin/prelude.ts export --format agents-md` writes `AGENTS.md`.
- `pnpm build && pnpm test` pass.
