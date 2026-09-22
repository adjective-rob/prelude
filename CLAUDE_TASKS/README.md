# Prelude: Cross-Codebase Routing Layer — Build Plan

This directory holds the ordered task specs for the next major Prelude capability.
Each `NN-*.md` file is self-contained: goal, context, exact files to touch,
interfaces, algorithms, tests, and acceptance criteria. Execute them in order.
Completed specs from earlier work live in `done/`.

Read this file first. Then read the task file you are about to execute, and only
that one. The repo `CLAUDE.md` still applies to everything.

---

## The thesis

Agents burn most of their tokens on unfamiliar codebases in the loop
`grep → read → grep again`. Prelude today tells an agent *what* a project is
(stack, constraints, decisions) but not *where to look*. Its own
`.context/architecture.json` lists eleven directories with file counts, guesses a
purpose for three of them, and leaves `entryPoints` empty. The hand-written
"Architecture" block in this repo's `CLAUDE.md` is what the tool should have
generated.

The end state is a **committed, human-editable, vendor-neutral routing index**:

1. Per project, a `map.json` that says which modules exist, what each is for,
   what each file exports, what depends on what, and which files are the hubs
   an agent should read first.
2. A `locate` operation that turns a task phrase into the handful of files most
   likely relevant. No embeddings, no server, no network.
3. A user-level **workspace** registry of many projects, served by one MCP
   server the developer registers once in their agent harness. From any
   session, the agent can ask what projects exist, what contract one exposes to
   another, and where to look inside any of them.
4. A **write path** so the agent records what it learned (decisions, module
   purposes, cross-project links) and the next session inherits it.

Nobody else ships this as a static artifact that lives in the repo and survives
across tools. Aider computes a repo map per session and throws it away.
Sourcegraph, Augment and Greptile run servers. Prelude's differentiator is that
the map is a file: diffable, correctable, committed.

---

## The end-state user experience

Once per repo:

```bash
cd ~/code/backend  && prelude init && prelude workspace add .
cd ~/code/frontend && prelude init && prelude workspace add .
```

Once per machine:

```bash
prelude mcp-config --workspace --client claude-code
# prints:  claude mcp add --scope user prelude -- prelude serve --workspace
```

Then in any agent session, anywhere on the machine:

| Agent call | What it gets back |
|---|---|
| `prelude_projects` | One block per project: name, purpose, stack, entry points, API surface, top hubs, related projects. About 150 tokens per project. |
| `prelude_compact(project="backend")` | The existing 800-token summary, now with a `[map]` line. |
| `prelude_locate(query="billing checkout", project="backend")` | `app/routers/billing.py`, `app/services/stripe.py`, with reasons. About 300 tokens. |
| *(agent reads those two files and does the work)* | |
| `prelude_record_decision(project="backend", title=..., rationale=...)` | Written to `.context/decisions.json`. |
| `prelude_link_projects(from="frontend", to="backend", relation="consumes", contract="REST /api/v1, JWT bearer")` | Written to frontend's `project.json`. |

The routing index has a forgiving failure mode. The agent reads the file it is
pointed to, so a wrong pointer costs one wasted read, not a wrong answer.
Regex-grade accuracy is acceptable here in a way it is not for constraints.

---

## Principles for this build

These extend the conventions in `CLAUDE.md`.

- **Pointers, not truth.** The map tells the agent where to look. It never
  paraphrases code. When a purpose cannot be inferred, omit it and show the
  exports instead. Do not fabricate.
- **Deterministic output.** Every array in a generated file is sorted (modules
  by path, files by path, hubs by in-degree then path). No timestamps in
  `map.json`. Small git diffs are a feature; `prelude diff --check` depends on
  it.
- **No embeddings, no daemons, no network.** `fs/promises`, `path`, regex.
  `locate` is keyword scoring over the map. It must run in under a second on a
  5,000-file repo.
- **Manual edits are sacred.** Module `purpose` overrides, module `notes`, and
  `relatedProjects` are never overwritten by `prelude update`.
- **Omit when empty.** No empty arrays in `.context/` files.
- **Best-effort everywhere.** Every scan block is wrapped in try/catch. One
  unreadable file never fails the map.
- **Agent-facing text is dense.** Tool descriptions say *when* to call the tool.
  Compact lines stay one line per section.
- **Schemas are the contract.** New fields go in the Zod schema, the JSON
  Schema, and `spec.md`, in that order, in the same task.

---

## Task order and dependencies

| # | Task | Depends on | Size |
|---|---|---|---|
| 00 | `00-context-dir-resolution.md` — one `resolveContextDir()`, fix exporter/updater ignoring `PRELUDE_ROOT`, remove debug logs | — | S |
| 01 | `01-map-scanner.md` — `src/core/map-scanner.ts`: exports, resolved imports, in-degree rank, modules, hubs, tests association, shared directory vocabulary | 00 | L |
| 02 | `02-map-schema-and-write.md` — `map.json` schema (Zod + JSON), written by `init`, merged by `update` with manual `purpose`/`notes` preserved, validated by `validate`, documented in `spec.md` | 01 | M |
| 03 | `03-map-formatters.md` — `map` as a query type; markdown, compact, export, CLAUDE.md, and new AGENTS.md output | 02 | M |
| 04 | `04-locate.md` — `src/core/locate.ts` scoring + `prelude locate` command | 02 | M |
| 05 | `05-mcp-tools-single-project.md` — `prelude_locate`, `prelude_map`, `prelude_record_decision`, `prelude_annotate_module`; `prelude annotate` CLI; server version from package.json | 03, 04 | M |
| 06 | `06-diff-command-and-check.md` — `prelude diff [--check]` as a CI guardrail; shared `computeDiff()` used by `update` | 02 | S |
| 07 | `07-workspace-registry.md` — `~/.prelude/workspace.json` + `index.json`, `prelude workspace add/remove/list/index`, `relatedProjects` on `project.json` | 02 | M |
| 08 | `08-workspace-serve.md` — `prelude serve --workspace`, `project` param on every tool, `prelude_projects`, `prelude_link_projects`, server instructions, `mcp-config --workspace` for user-scope registration | 05, 07 | L |
| 09 | `09-dogfood-and-release.md` — regenerate Prelude's own context, tune heuristics until the map matches `CLAUDE.md`, index a Python project, register the workspace locally, bump to 1.9.0, rewrite README roadmap | all | M |

Tasks 03 and 04 are independent of each other. Tasks 06 and 07 are independent
of 03–05. Everything else is sequential.

---

## Definition of done (whole plan)

1. `pnpm build && pnpm test` pass. Lint passes.
2. On this repo, `prelude init --force` produces a `map.json` whose module
   purposes for `bin`, `src/commands`, `src/core`, `src/mcp`, `src/schema`,
   `src/utils`, `tests` are each a sensible short phrase, and whose `hubs`
   include `src/utils/fs.ts`, `src/constants.ts`, and `src/core/query-engine.ts`.
3. `prelude locate "preserve manual edits during update"` returns
   `src/core/merger.ts` and `src/core/state-manager.ts` in its top three.
4. `prelude locate "mcp server tools"` returns `src/mcp/server.ts` first.
5. On a Python FastAPI project, `map.json` resolves `from app.x import y`
   imports and the workspace index lists its API endpoints.
6. A workspace with two projects is served by one `prelude serve --workspace`
   process, and `prelude_projects`, `prelude_locate` (with and without
   `project`), `prelude_record_decision`, and `prelude_link_projects` all work
   from an MCP client in tests.
7. `prelude diff --check` exits 1 when a source file is added and 0 when
   nothing changed.
8. `prelude export --format agents-md` writes an `AGENTS.md` with the module
   map.
9. `README.md` documents the workspace flow in its first screen. The roadmap no
   longer lists the VS Code extension or plugin system.

---

## How to run

By hand, one task per session, committing after each:

```bash
claude -p "$(cat CLAUDE_TASKS/01-map-scanner.md)"
pnpm build && pnpm test
git add -A && git commit -m "prelude: 01-map-scanner"
```

Or all at once with `./run-prelude-tasks.sh` (its `TASKS` list is already
updated). Commit messages use the task slug. Push to `main` after each task or
after the run.

If a task's spec conflicts with what you find in the code, the code you find is
the truth about *what exists*, and the spec is the truth about *what to build*.
Note the conflict in the commit message and keep going.
