# Contributing to Prelude

Thanks for helping. Prelude is small on purpose: regex heuristics, no AST parsers, a handful of runtime dependencies. Most contributions are a new detector, a new language for the code map, or a fix for a project layout the heuristics got wrong.

## Setup

Development requires Node.js >= 22.13 and pnpm 11. (The published package runs on Node.js >= 20.19, and CI tests it there.)

```bash
git clone https://github.com/adjective-rob/prelude.git
cd prelude
pnpm install
pnpm build                 # tsc -> dist/
pnpm exec vitest run       # run the tests once
pnpm lint
tsx bin/prelude.ts init    # run the CLI from source
```

[CLAUDE.md](./CLAUDE.md) has the architecture overview and the data flow for each command. Read it first; it is short.

## Ground rules

- **ESM only.** Import paths end in `.js`, even when the source file is `.ts`.
- **Inference is best-effort.** Wrap every detection block in try/catch. One unreadable file must never crash the CLI.
- **Manual edits are sacred.** `prelude update` must never overwrite a field a human set. If you add a field a human can edit, make sure `merger.ts` preserves it.
- **Omit empty fields.** Don't write empty arrays into `.context/` files.
- **Output is deterministic.** Sorted arrays, no timestamps in `map.json`.
- **No heavy dependencies.** The scanners use `fs/promises`, `path`, and regex.
- **Tests use temp directories.** Create fixtures under `os.tmpdir()` with `mkdtemp` and clean up in `afterAll`. Don't add fixture projects to the repo tree.

## Recipes

### Add a framework or tool detector

1. Find the matching block in `src/core/infer.ts` (`inferStack` for dependencies, `inferArchitecture` for layout, `inferConstraints` for lint/test conventions). Source-level patterns that need to read code go in `src/core/source-scanner.ts`.
2. Add the detection next to its siblings, for example `if (allDeps['hono']) frameworks.push('Hono');`.
3. Add a test in `tests/` that builds a minimal project in a temp directory and asserts on the inferred output. `tests/python-inference.test.ts` and `tests/rust-go-inference.test.ts` are good models.

### Add a language to the code map

The code map (`map.json`) supports TypeScript/JavaScript, Python, Go, and Rust. To add another:

1. Add the extension to `SOURCE_EXTENSIONS` in `src/core/source-scanner.ts` and to `LANG_BY_EXT` in `src/core/map-scanner.ts`.
2. Add the language code to `MapLangSchema` in `src/schema/map.ts` and to the `lang` enum in `schemas/map.schema.json`. The two must stay in sync.
3. In `src/core/map-scanner.ts`, add a case to `stripComments`, an `extractXExports` function wired into `extractExports`, and an import resolver wired into the `switch (p.lang)` in `buildMap`.
4. Teach `isTestFile` in `src/core/source-scanner.ts` the language's test file convention.
5. Add cases to `tests/map-scanner.test.ts`.

### Change the context format

1. Add the field to the Zod schema in `src/schema/` as `.optional()`.
2. Add it to the matching JSON Schema in `schemas/` (not in `required`).
3. Add detection logic.
4. Add formatting to all three output paths: `exporter.ts`, `query-engine.ts` `formatArchitectureSection`, and `query-engine.ts` `formatCompactArchitecture`. Map fields are formatted in `map-format.ts` instead.
5. Document it in `spec.md` and add tests.

### Improve `prelude locate`

`bench/locate-bench.ts` replays a repository's git history as a retrieval task: each commit subject is a query, the files that commit changed are the answer, and the repo is checked out at the parent commit. It reports hit rate, recall, and MRR for `locate` next to a ranked-grep baseline.

```bash
git clone --depth 600 https://github.com/spf13/cobra /tmp/cobra
pnpm exec tsx bench/locate-bench.ts /tmp/cobra --commits 100
```

Run it before and after a scoring change and include both tables in the pull request.

## Pull requests

- Keep each pull request to one change.
- `pnpm lint`, `pnpm build`, and `pnpm exec vitest run` must pass. CI runs all three on Node 20, 22, and 24.
- This repo keeps its own `.context/` committed, and CI fails a pull request when it has drifted. If your change adds, removes, or moves source files, run `tsx bin/prelude.ts update` and commit the result.
- Add a line to `CHANGELOG.md` under an `Unreleased` heading for anything a user would notice.

## Reporting bugs

Inference bugs are easiest to fix with a reproduction: the manifest file (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`), the directory layout, what Prelude wrote, and what you expected. The issue template asks for these.

## Releasing (maintainers)

1. Bump `version` in `package.json` and add the `CHANGELOG.md` section.
2. `pnpm build && pnpm exec vitest run`, and commit.
3. Tag `vX.Y.Z` and push the tag. The Release workflow checks the tag matches `package.json`, runs the checks again, and publishes to npm with provenance through npm trusted publishing. Then create the GitHub release from the changelog section.
4. Move the major tag so `uses: adjective-rob/prelude@v1` picks up the release: `git tag -f v1 vX.Y.Z && git push -f origin v1`.
