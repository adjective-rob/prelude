# Task 06: `prelude diff [--check]` — the CI guardrail

## Goal

Print what `prelude update` *would* change, without writing. With `--check`,
exit 1 when anything would change, so CI fails when committed context has
drifted from the code. Share the computation with `update` so the two can
never disagree.

## Context

`src/commands/update.ts` already does exactly this under `--dry-run`, but
the logic (read existing, infer, merge, collect changes, `displayChanges`)
lives inline in the command. `prelude update --dry-run` also still creates a
state backup? Check: it skips `backup()` when `dryRun`. Good.

`action.yml` runs `prelude ${{ inputs.args }}` then opens a PR if `.context/`
changed. `.github/workflows/prelude-update.yml` does the same for this repo.

Noise to suppress: `project.updatedAt` changes on every run;
`preserved` changes are informational, not drift.

## What to change

### `src/core/diff.ts` (new)

```ts
export interface ContextChange extends MergeChange { file: string }
export interface DiffResult {
  changes: ContextChange[];          // everything, including 'preserved'
  drift: ContextChange[];            // changes minus 'preserved' minus ignored fields
  merged: { project; stack; architecture; constraints; map? };
  inferred: { ... same shape ... };
}
export async function computeDiff(rootDir: string): Promise<DiffResult>
```

Moves the read/infer/merge block out of `update.ts`. Ignored fields for
`drift`: `project.json:updatedAt`. Uses `resolveContextDir(rootDir)` and a
`StateManager` opened read-only (do not call `save()` or `backup()`).

`update.ts` calls `computeDiff`, then does backup/write/track as before.
`forceUpdate` keeps its own path but should reuse `computeDiff`'s merged
output too; the only difference in force mode is that `--dry-run` is
skipped. If that turns out to be all, delete `forceUpdate` and gate on
`options.force` inline.

Move `displayChanges` to `src/core/diff.ts` as `formatChanges(changes,
{ color: boolean }): string` returning a string (no direct `console.log`),
so the CLI and tests can both use it.

### `src/commands/diff.ts` (new) and `bin/prelude.ts`

```
prelude diff [dir] [--check] [--format text|json] [--all]
```

- Default prints `drift` in the text format; `--all` prints `changes`.
- `--format json` prints `{ changed: boolean, count: number, changes: [...] }`.
- `--check`: exit 1 when `drift.length > 0`, else 0. In text mode print a
  final line `Context is up to date.` or
  `Context has drifted: N changes. Run \`prelude update\`.`
- Missing `.context/` → error, exit 1, same message as other commands.

### `action.yml`

Add input `check` (boolean string, default `"false"`). When `"true"`, add a
step before "Run prelude" that runs `prelude diff --check` and let its
non-zero exit fail the job. Document both modes in the description: "guard"
(fail on drift) and "update" (open a PR). Update `README.md`'s GitHub Action
section with a two-job example: a `check` job on pull requests, an `update`
job on push to main.

### `.github/workflows/prelude-update.yml`

Add a `check` job triggered on `pull_request` that runs `prelude diff --check`.
Keep the existing update job.

## Tests

`tests/diff.test.ts` with a temp project initialised via the same helpers
`tests/init.test.ts` uses:

1. Right after init, `computeDiff` returns `drift.length === 0`
   (`updatedAt` churn is ignored).
2. Add `src/newmod/thing.ts` exporting a function; `drift` contains an
   `added` change for `map.json` module `src/newmod` and an `added`
   change for `architecture.json` directories.
3. Hand-edit a module purpose and track it manual; `computeDiff` reports it
   under `changes` as `preserved` but not under `drift`.
4. `formatChanges` output for a fixed change list matches a snapshot-free
   string assertion (contains `+ `, `- `, `~ ` markers and the file names).
5. `--format json` shape (call the command's formatter function directly;
   do not spawn a process).

## Acceptance

- On this repo with fresh context: `tsx bin/prelude.ts diff --check` exits 0.
  Touch a new source file: exits 1 and names the module.
- `prelude update` output is unchanged for the user.
- `pnpm build && pnpm test` pass.
