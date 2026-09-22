# Task 02: `map.json` — schema, write on init, merge on update, validate, spec

## Goal

Give the `CodeMap` from Task 01 a home: `.context/map.json`. Define its Zod
and JSON schemas. Write it during `prelude init`. Regenerate it during
`prelude update` and `prelude watch` while preserving manually edited module
`purpose` and any `notes`. Validate it. Document it in `spec.md`.

## Context

- `src/constants.ts` `CONTEXT_FILES` lists every context file.
- `src/commands/init.ts` writes each file inside its own spinner + try/catch.
- `src/commands/update.ts` reads existing files, re-infers, calls
  `ContextMerger.merge*`, writes, then `trackAllFields()` per file. It also
  has a `forceUpdate` path. `trackAllFields` hashes **top-level keys**; for
  `map.json` that would make `modules` one giant field that flips to
  `manual` on any hand edit and then freezes the whole map. Do not use it for
  the map.
- `src/core/updater.ts` (`updateContext`, `refreshAll`) is what `prelude watch`
  calls. It re-infers architecture when source files change; the map must be
  rebuilt at the same time.
- `src/core/state-manager.ts` tracks field state per file at arbitrary dotted
  paths: `trackInferred(file, path, value)`, `trackManual`, `isManuallyEdited`,
  `hasInferredChanged(file, path, newValue)`, `getFieldState`.
- `src/commands/validate.ts` has `FILE_SCHEMA_MAP` and a hand-rolled JSON
  Schema validator that supports `type`, `required`, `properties`, `items`,
  `enum`, and `additionalProperties`. Check what it supports before writing
  the JSON Schema; keep the schema within that subset.
- Every schema file declares `SCHEMA_URL = "https://adjective.us/prelude/schemas/v1"`.

## What to change

### `src/constants.ts`

Add `MAP: 'map.json'` to `CONTEXT_FILES`.

### `src/schema/map.ts` (new) and `src/schema/index.ts`

Zod schema mirroring the interfaces in Task 01 exactly. All fields beyond
`$schema`, `version`, `stats`, `modules`, and per-file `file`/`lang`/`lines`,
per-module `path`/`fileCount`/`files` are `.optional()`. Export `MapSchema`,
`MapModuleSchema`, `MapFileSchema`, and the inferred types. Re-export from
`index.ts`. Then change `map-scanner.ts` to import its types from the schema
instead of declaring its own interfaces (single source of truth; keep the
exported names `CodeMap`, `MapModule`, `MapFile`, `MapHub` as type aliases so
Task 01's tests still compile).

### `schemas/map.schema.json` (new)

JSON Schema draft-07 like the others, `"additionalProperties": true` at every
object level, `required` only for the fields listed above. Include
`description` strings on `modules`, `hubs`, `purpose`, `notes`, `rank`,
`importedBy`, `dependsOn`, `tests` so the schema is self-explaining when
served from adjective.us.

### `src/commands/init.ts`

After the architecture block and before decisions:

```ts
const mapSpin = spinner('Building code map...');
try {
  const map = await buildMap(rootDir, { architecture });
  await writeJSON(join(contextDir, CONTEXT_FILES.MAP), map);
  mapSpin.stop(`✓ Generated map.json (${map.stats.files} files, ${map.stats.modules} modules)`);
} catch (error) {
  mapSpin.stop();
  logger.error(`Failed to generate map.json: ${error}`);
}
```

`architecture` must be in scope; it is declared inside the architecture
`try`. Hoist a `let architecture: Architecture | undefined` above.

### `src/core/merger.ts` — `mergeMap`

```ts
mergeMap(existing: CodeMap | undefined, inferred: CodeMap): MergeResult<CodeMap>
```

Rules:
1. Start from `inferred`.
2. For each inferred module with a matching existing module (same `path`):
   - If `existing.notes` is set, copy it. Never inferred, always preserved.
   - If `stateManager.isManuallyEdited('map.json', `modules.${path}.purpose`)`,
     copy `existing.purpose` and push a `preserved` change.
   - Else if `existing.purpose` is set and differs from `inferred.purpose`,
     and `stateManager.getFieldState('map.json', `modules.${path}.purpose`)`
     exists and `hasInferredChanged(...)` reports the *existing* value differs
     from the last inferred hash: the user hand-edited the JSON. Treat as
     manual: copy it, call `trackManual`, push `preserved`.
3. Changes to report (used by `prelude diff`, Task 06):
   - `added` / `removed` per module path.
   - One `modified` change with field `hubs` when the ordered list of hub
     file names differs, `oldValue`/`newValue` = the two lists (first 5 only).
   - Per module still present, one `modified` change with field
     `modules.<path>.files` when the set of file names differs; `oldValue`
     and `newValue` are the removed and added names respectively.
   Do **not** report `rank`, `importedBy`, `lines`, or `exports` churn. Those
   change constantly and would drown the useful signal.
4. If `existing` is undefined, return `inferred` with a single `added` change
   for field `map`.

### `src/core/state-manager.ts` — `trackMapFields`

Not on the class; a standalone helper in `update.ts` next to `trackAllFields`:

```ts
function trackMapFields(stateManager: StateManager, merged: CodeMap, inferred: CodeMap): void
```

For each merged module: path `modules.<path>.purpose`. If merged purpose
equals inferred purpose (or both undefined) → `trackInferred`; else
`trackManual`. Nothing else in the map is tracked.

### `src/commands/update.ts`

- Read `existing.map` with `safeReadJSON` (it may be absent on projects
  initialised before this version; treat `{}` as undefined).
- `inferred.map = await buildMap(process.cwd(), { architecture: inferred.architecture })`.
- Smart-merge path: `merger.mergeMap(existing.map, inferred.map)`, include its
  changes in `allChanges` under file `map.json`, write, `trackMapFields`.
- `forceUpdate`: same merge (manual purposes survive force too, like
  project name does), write.
- Wrap the `buildMap` call in try/catch; on failure log a warning and skip
  the map (never fail the whole update).

### `src/core/updater.ts`

In `updateContext`, when `needsArchUpdate`, also build and write the map
(with the freshly inferred architecture). In `refreshAll`, always. Use
`mergeMap` here too via a `StateManager(contextDir)` so watch mode does not
clobber manual purposes.

### `src/commands/validate.ts`

Add `[CONTEXT_FILES.MAP]: 'map.schema.json'` to `FILE_SCHEMA_MAP`. Missing
`map.json` is not an error (older projects); check how missing files are
handled today and match it.

### `spec.md`

- §3.1 directory listing: add `map.json`.
- New §4.9 `map.json` after `session.json`: purpose, required fields, optional
  fields, a trimmed example (two modules, three files, two hubs), and a
  paragraph on manual overrides (`purpose`, `notes`) and determinism (no
  timestamps; sorted arrays).
- Renumber `export.md` to §4.10 and fix the table of contents.

### `README.md`

One paragraph under "What Prelude generates" introducing `map.json` and a
short example. Full docs come in Task 09.

## Tests

`tests/map-merge.test.ts`:

1. Merge with no existing map returns inferred and one `added` change.
2. Existing module with `notes` → notes preserved.
3. State says `modules.src/core.purpose` is manual → existing purpose wins,
   `preserved` change reported.
4. State has an inferred hash for the purpose, existing JSON has a different
   purpose (hand edit) → preserved and now tracked manual.
5. Module removed and module added → one `removed`, one `added`.
6. Hubs reordered → exactly one `modified` change with field `hubs`.
7. Only `rank` values changed → zero changes.

Extend `tests/init.test.ts`: `map.json` exists after init, parses, has
`modules.length > 0`, and `validate` reports it valid (call the validator
function directly if it is exported; export it if not).

## Acceptance

- `prelude init --force` on this repo writes `.context/map.json`.
- Hand-edit `src/core`'s purpose in `map.json`, run `prelude update`: the edit
  survives and the update output shows it as preserved. Run `prelude update`
  again: no changes.
- `prelude validate` passes with the new file.
- `pnpm build && pnpm test` pass.
