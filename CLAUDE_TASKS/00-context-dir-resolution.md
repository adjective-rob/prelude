# Task 00: One `resolveContextDir()` — stop duplicating external-brain logic

## Goal

Every command and core module resolves the context directory the same way, in
one place. Fix two modules that currently ignore `PRELUDE_ROOT`. Remove the
debug `console.log` lines left in `init.ts`. Nothing user-visible changes
except the bug fixes.

## Context

The block

```ts
const externalRoot = process.env.PRELUDE_ROOT;
const contextDir = externalRoot
  ? join(externalRoot, rootDir.split('/').pop() as string)
  : join(rootDir, CONTEXT_DIR);
```

is copy-pasted in twelve places:
`src/mcp/server.ts` (twice), `src/core/query-engine.ts` (twice),
`src/commands/{watch,serve,query,update,share,compact,export,init,decision,validate}.ts`.
`update.ts` uses `process.cwd().split('/').pop()`, which is the same thing
with `rootDir = process.cwd()`.

Two modules **do not** have the block and therefore break in external-brain
mode:

- `src/core/exporter.ts` — `exportToMarkdown`, `exportToJSON`,
  `exportToClaudeMd`, `saveExport` all use `join(rootDir, CONTEXT_DIR)`.
- `src/core/updater.ts` — `updateContext` and `refreshAll` (used by
  `prelude watch`) use `join(rootDir, CONTEXT_DIR)`.

`src/runtime/context.ts` already exists with `resolvePreludeRoot()` and
`resolveProjectContextDir(projectName)`. Check whether either is imported
anywhere (`grep -rn "runtime/context" src bin`). If not, replace the file's
contents. If they are, keep them and add the new function.

`src/commands/init.ts` lines 27–28 print `DEBUG PRELUDE_ROOT:` and
`RUNTIME PRELUDE_ROOT:` to stdout on every init. Delete both lines.

## What to change

### `src/runtime/context.ts`

```ts
import { join, resolve, basename } from 'path';
import { CONTEXT_DIR } from '../constants.js';

/**
 * Resolve where a project's context lives.
 * Embedded mode (default): <rootDir>/.context
 * External brain mode (PRELUDE_ROOT set): <PRELUDE_ROOT>/<project basename>
 */
export function resolveContextDir(rootDir: string): string {
  const externalRoot = process.env.PRELUDE_ROOT;
  const absRoot = resolve(rootDir);
  if (externalRoot) {
    return join(resolve(externalRoot), basename(absRoot));
  }
  return join(absRoot, CONTEXT_DIR);
}

export function isExternalBrainMode(): boolean {
  return Boolean(process.env.PRELUDE_ROOT);
}
```

`basename(resolve(rootDir))` replaces `split('/').pop()`. It handles trailing
slashes, `.`, and Windows separators. Behaviour is otherwise identical.

### Replace every duplicated block

In each of the twelve sites, delete the three-line block and use
`resolveContextDir(rootDir)` (or `resolveContextDir(process.cwd())` in
`update.ts`). Remove now-unused imports of `CONTEXT_DIR` and `join` where
applicable; the linter will tell you.

### Fix `src/core/exporter.ts` and `src/core/updater.ts`

Replace `join(rootDir, CONTEXT_DIR)` with `resolveContextDir(rootDir)` in every
function. `saveExport` writes `export.md`, `export.json`, and `.cursorrules`
into `contextDir`; check where it writes `CLAUDE.md` and keep that target
unchanged.

### `src/core/state-manager.ts`

Already takes `contextDir` in its constructor. No change. But note the
top-of-file constants `STATE_DIR`, `STATE_FILE`, `HISTORY_DIR` are unused
(the methods build paths from `this.contextDir`). Delete them.

## Tests

Add `tests/context-dir.test.ts`:

- With `PRELUDE_ROOT` unset, `resolveContextDir('/tmp/foo')` is `/tmp/foo/.context`.
- With `PRELUDE_ROOT=/tmp/brain`, `resolveContextDir('/tmp/foo/')` is `/tmp/brain/foo`.
- With `PRELUDE_ROOT=/tmp/brain`, `resolveContextDir('.')` uses the basename of
  `process.cwd()`.
- Restore `process.env.PRELUDE_ROOT` in `afterEach`.

Add one case to `tests/export-formats.test.ts`: with `PRELUDE_ROOT` pointing at
a temp dir that contains `<basename>/project.json`, `exportToMarkdown(rootDir)`
finds the project name. This is the regression test for the exporter bug.

## Acceptance

- `grep -rn "split('/').pop()" src bin` returns nothing.
- `grep -rn "process.env.PRELUDE_ROOT" src` returns only `src/runtime/context.ts`.
- `prelude init` prints no `DEBUG` lines.
- `pnpm build && pnpm test` pass.
