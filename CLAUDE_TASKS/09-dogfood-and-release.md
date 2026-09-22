# Task 09: Dogfood, tune, document, release 1.9.0

## Goal

Prove the whole thing on real repositories, tune heuristics until the
generated map is as good as the hand-written one, register the workspace on
this machine, and ship.

## Context

This repo's `CLAUDE.md` has a hand-written architecture block. It is the
benchmark: after this task, `map.json` plus `prelude export --format
claude-md` should reproduce its substance without a human.

A second benchmark is a Python FastAPI backend at `~/Desktop/gerolamo`
(Supabase, Render). Its API contract is currently pasted by hand into the
user's global `CLAUDE.md` so a frontend agent can see it. The workspace
index should make that unnecessary.

The user's global preferences say commit and push automatically. `npm
publish` is a different matter: build and test, then **ask before
publishing**.

## Steps

### 1. Regenerate this repo's context

```bash
pnpm build
tsx bin/prelude.ts init --force
tsx bin/prelude.ts compact
tsx bin/prelude.ts locate preserve manual edits during update
tsx bin/prelude.ts locate mcp server tools
tsx bin/prelude.ts export --format claude-md
```

Compare `.context/map.json` and the exported architecture section against
the `CLAUDE.md` architecture block. Required outcomes:

- Modules `bin`, `src/commands`, `src/core`, `src/mcp`, `src/schema`,
  `src/utils`, `src/runtime`, `tests`, `schemas` each have a purpose.
- `hubs` include `src/utils/fs.ts`, `src/constants.ts`,
  `src/core/query-engine.ts`, `src/schema/index.ts`.
- Both `locate` calls satisfy the definition of done in
  `CLAUDE_TASKS/README.md`.
- `entryPoints` in `architecture.json` is no longer empty: add detection
  for `bin/*.ts|js` files with a shebang or listed in `package.json`
  `bin`, role "CLI entry point". This is a small `infer.ts` change; add a
  test.

Where the outcome falls short, fix the heuristic (vocab, export regex,
resolution), not the fixture. Record each tuning change in the commit
message.

Commit the regenerated `.context/` (this repo commits its own context).

### 2. Python benchmark

```bash
cd ~/Desktop/gerolamo
ls .context 2>/dev/null || prelude init
prelude update
prelude compact
prelude locate stripe checkout webhook
prelude locate rate limit
```

Required outcomes:

- `map.json` resolves `from app.x import y` style imports (edges > 0,
  `unresolvedImports` well under 20% of edges). If the package root is not
  `app`, the resolver's package-root discovery (dirs containing
  `__init__.py`) must find it.
- `architecture.apiEndpoints` lists the FastAPI routes; the workspace index
  reports the count.
- `locate stripe checkout webhook` returns the billing router or service
  in its top three.

Fix heuristics as needed in this repo (not in gerolamo), rebuild, rerun.
When it looks right, commit gerolamo's `.context/` there with message
`chore: add Prelude context`.

### 3. Register the workspace on this machine

```bash
prelude workspace add ~/Desktop/prelude
prelude workspace add ~/Desktop/gerolamo
prelude workspace list
prelude mcp-config --workspace --client claude-code
```

Run the printed `claude mcp add --scope user …` command. Then from a fresh
Claude Code session in `/tmp`, confirm `prelude_projects` lists both and
`prelude_locate(query="stripe webhook", project="gerolamo")` works. Note
the result in the commit message.

### 4. Documentation

- `README.md`: rewrite the top so the first screen is the workspace flow
  (four commands, then the table of what the agent gets). Then the
  single-project flow. Then the command reference including `locate`,
  `annotate`, `diff`, `workspace`. Update the MCP tools table (single and
  workspace). Rewrite the Roadmap: mark done the items delivered here;
  remove the VS Code extension and plugin system; keep "temporal brain
  layer" and add "PageRank-weighted ranking", "gitignore-aware walking",
  "tree-sitter-backed exports for more languages" as future items.
- `CLAUDE.md` (this repo): update the architecture block with
  `map-scanner.ts`, `vocab.ts`, `locate.ts`, `diff.ts`, `decisions.ts`,
  `map-annotate.ts`, `workspace.ts`, `runtime/context.ts`,
  `runtime/home.ts`, and the new commands. Add the data-flow lines for
  `prelude locate`, `prelude diff`, `prelude workspace`. Add a "Schema
  changes" step for `map.json` and `workspace.json`.
- `spec.md`: confirm §4.9 `map.json`, `relatedProjects`, and add §5
  "Workspace" describing `~/.prelude/workspace.json` and `index.json` as a
  non-committed, machine-local layer of the standard.
- `CHANGELOG.md` (create if absent) with a 1.9.0 entry listing: map.json,
  locate, annotate, diff --check, AGENTS.md export, workspace registry,
  workspace MCP server, four new MCP write/read tools, PRELUDE_ROOT fixes.

### 5. Release

- Bump `package.json` to `1.9.0`. Update the `version` string the MCP
  server reports (it now comes from `package.json`, verify).
- Update `run-prelude-tasks.sh` `TASKS` to the new list if not already
  done.
- `pnpm lint && pnpm build && pnpm test`.
- Commit and push.
- Ask the user before `npm publish`. If they say yes: `npm publish`, then
  `git tag v1.9.0 && git push --tags`.

## Acceptance

Every item in "Definition of done" in `CLAUDE_TASKS/README.md` is true, and
the user can open a new agent session anywhere on this machine and ask
"what projects do I have and where does gerolamo handle Stripe webhooks"
and get a correct answer from Prelude tools alone.
