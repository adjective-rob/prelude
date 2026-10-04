# Prelude

**Project memory and a code map for AI agents: where to look, why the code is the way it is, and what a change will touch.**

[![npm version](https://img.shields.io/npm/v/prelude-context.svg)](https://www.npmjs.com/package/prelude-context)
[![CI](https://github.com/adjective-rob/prelude/actions/workflows/ci.yml/badge.svg)](https://github.com/adjective-rob/prelude/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node >= 20.19](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen.svg)](https://nodejs.org)

An agent with grep can find where a word appears. It cannot find out why the code is shaped the way it is, which tests cover a file, how many other files depend on it, or what the last session learned. That knowledge isn't in the source.

Prelude keeps it in the repo. It scans the project once and writes a small set of JSON files to `.context/`: the stack, the architecture, the constraints, the decisions, and a code map of every module, its exports, and what imports what. You commit those files, and agents add to them as they work. Every later session starts from them, through an MCP server, a generated `CLAUDE.md` / `AGENTS.md`, or plain stdout.

No embeddings, no server to host, no network calls. Regex heuristics over TypeScript/JavaScript, Python, Go, and Rust.

![Terminal: prelude init, then prelude locate returning ranked files with reasons](https://raw.githubusercontent.com/adjective-rob/prelude/main/.github/assets/demo.svg)

## Quick start

```bash
cd your-project
npx prelude-context init        # writes .context/
```

Or install it, which gives you the `prelude` command used in the rest of this README:

```bash
npm install -g prelude-context
prelude init
```

Then give it a task phrase:

```bash
prelude locate preserve manual edits during update --limit 2
```

```
1. src/core/merger.ts  ·  src/core (Core business logic)  ·  score 32
   exports: MergeResult, MergeChange, ContextMerger, trackMapFields
   why: decision: Manual edits are sacred, content preserve×25, manual×31, edit×9, update×6, matches all terms
   impact: imported by 4 files  ·  tests: tests/map-merge.test.ts, tests/mcp-server.test.ts, tests/merge-preserve.test.ts
   decisions: Manual edits are sacred
2. src/core/state-manager.ts  ·  src/core (Core business logic)  ·  score 26
   exports: StateManager
   why: decision: Manual edits are sacred, content manual×9, edit×4, update×6, matches all terms
   impact: imported by 7 files  ·  tests: tests/map-merge.test.ts, tests/mcp-server.test.ts, tests/merge-preserve.test.ts
   decisions: Manual edits are sacred
```

One call returns the files to read, why each was picked, what depends on them, the tests to run afterwards, and the recorded decision that constrains the change. That is real output from this repository, which keeps its own [`.context/`](./.context) committed. Browse it to see what Prelude writes.

Requires Node.js >= 20.19.

## What you get

```
your-project/
└── .context/
    ├── project.json        what the project is
    ├── stack.json          language, runtime, frameworks, tooling
    ├── architecture.json   type, patterns, directories, entry points, routes
    ├── constraints.json    rules and preferences
    ├── decisions.json      architecture decisions and their rationale
    ├── map.json            modules, exports, import graph, hub files
    ├── changelog.md        project timeline
    └── .prelude/           state: which fields were inferred, which you edited
```

Commit `.context/`. Gitignore `.context/*.session.json`.

`prelude compact` prints the whole thing as one dense line per section, sized for a system prompt (a few hundred tokens for this repo):

```
[project] prelude-context | The open standard for expressing and maintaining machine-readable context about a codebase
[stack] TypeScript/JavaScript Node.js >=20.19.0 | pnpm | testing: Vitest
[arch] type=cli | patterns: Utility modules | entry: bin/prelude.ts | dirs: bin (Executable entry points), src/commands (Command handlers), src/core (Core business logic), src/mcp (MCP server), ...
[decisions] Manual edits are sacred (accepted); Regex heuristics, not AST parsers (accepted); Schemas are the contract (accepted); ...
[map] hubs: src/utils/fs.ts(25), src/runtime/context.ts(20), src/schema/index.ts(18), ... | src/core (Core business logic): state-manager.ts, infer.ts, map-scanner.ts +15 | ...
```

## What grep can't tell an agent

| Question | Where Prelude gets the answer |
|---|---|
| Why is this code the way it is? | `decisions.json`: decisions and rationale, recorded by you or by an agent with `prelude_record_decision` |
| What depends on this file? | `map.json`: the resolved import graph, importer counts, hub files |
| Which tests cover it? | `map.json`: the test files that import it |
| What did the last session learn about this module? | Module notes, written with `prelude annotate` or `prelude_annotate_module` and never overwritten |
| What must I not do here? | `constraints.json` |
| How does this repo talk to that one? | `relatedProjects` in `project.json`, served across repos in workspace mode |

`prelude locate` attaches the first four to every file it returns. On a freshly initialised project the decisions and notes are empty; the import graph and tests are there from the first run, and the rest accumulates as people and agents record it.

### How well does `locate` find files?

`bench/locate-bench.ts` replays a repository's git history: each commit subject is a query, the files that commit changed are the answer, and the repo is checked out at the parent commit so nothing sees the change itself. The baseline is a grep for each query term over the same files, ranked by distinct terms matched. Share of queries with a correct file in the top 8:

| Repo | Source files | Ranked grep | `prelude locate` |
|---|---|---|---|
| cobra (Go) | 37 | 95% | 96% |
| flask (Python) | 82 | 83% | 86% |
| hono (TypeScript) | 361 | 88% | 97% |
| ripgrep (Rust) | 100 | 64% | 79% |
| typer (Python) | 629 | 76% | 74% |
| express (JavaScript) | 147 | 87% | 90% |
| **Average** | | **82%** | **87%** |

The top result is correct 48% of the time, against 39% for grep. Up to 100 commits per repo. The scoring weights were chosen using these same six repositories, so treat the numbers as in-sample; run the script on your own repo to check (see [CONTRIBUTING.md](./CONTRIBUTING.md#improve-prelude-locate)). File-finding is the baseline here, not the point: the table above is.

## Why not just write a CLAUDE.md or AGENTS.md?

Keep them. Prelude generates both (`prelude export --format claude-md`, `--format agents-md`) and can bootstrap from one you already have (`prelude init --from-claude-md`). The difference is what sits underneath:

- **It doesn't rot silently.** A hand-written context file is correct on the day it is written. `prelude diff --check` exits 1 when the committed context no longer matches the code, so CI catches the drift.
- **It is structured.** JSON with a published schema, so tools can query one section, one directory, or one module instead of loading a whole markdown file.
- **It answers "where" and "what else".** `prelude locate` turns a task phrase into a short list of files with the reason each was picked, the tests that cover it, and the decisions that apply. A prose file can't do that.
- **Your edits survive.** Prelude tracks which fields it inferred and which you wrote. `prelude update` refreshes the first kind and never touches the second.
- **It spans projects.** Register several repos once and a single MCP server answers for all of them, including how they relate.
- **It isn't tied to one tool.** The same files feed Claude Code, Cursor, Codex, Claude Desktop, or anything that reads JSON.

### How it relates to other approaches

- **In-session repo maps** (Aider's, for example) are computed when the session starts and discarded when it ends. Prelude's map is a file: diffable in a pull request, correctable by hand, shared by the whole team.
- **Hosted code search and indexing services** are more powerful retrieval, and they are a service to run or pay for. Prelude is static files and a local CLI.
- **Embedding-based retrieval** finds semantic matches that Prelude's term matching will miss. Prelude's results are deterministic and explain themselves, and they cost nothing to produce.

## Use it from an agent (MCP)

Prelude runs as an [MCP](https://modelcontextprotocol.io/) server over stdio.

### One project

From a project that has a `.context/` directory, register the server with Claude Code:

```bash
claude mcp add prelude-context -- npx -y prelude-context serve
```

For any other client, the server command is `npx -y prelude-context serve --root /path/to/project`:

```json
{
  "mcpServers": {
    "prelude-context": {
      "command": "npx",
      "args": ["-y", "prelude-context", "serve", "--root", "/path/to/project"]
    }
  }
}
```

`prelude mcp-config --client claude-code | cursor | codex | claude-desktop` prints the exact snippet for your machine and client. The read tools are annotated read-only, so clients that honour tool annotations can run them without asking.

| Tool | What the agent gets |
|------|-------------|
| `prelude_compact` | The token-budgeted overview (about 800 tokens by default), including the `[map]` line |
| `prelude_locate` | The files most relevant to a task phrase, each with reasons, importer count, covering tests, applicable decisions, and notes |
| `prelude_map` | Hubs and modules, one module in detail, or one file's exports and importers |
| `prelude_query` | Context filtered by topic, directory scope, or type |
| `prelude_record_decision` | Appends a decision to `decisions.json` so later sessions inherit it |
| `prelude_annotate_module` | Corrects a module's purpose or adds notes in `map.json`; never overwritten by update |
| `prelude_status` | Which context files exist |

Resources: `prelude://context/full`, `prelude://context/compact`, `prelude://context/map`, and `prelude://context/{type}` for a single file.

### Every project on the machine

Register each codebase once, register Prelude once in your agent harness, and every session can see all of your projects: what each one is, how they relate, and where to look inside any of them.

```bash
# once per repo
cd ~/code/backend  && prelude init && prelude workspace add .
cd ~/code/frontend && prelude init && prelude workspace add .

# once per machine
prelude mcp-config --workspace --client claude-code
# prints:  claude mcp add --scope user prelude -- prelude serve --workspace
```

In workspace mode every tool takes an optional `project`, and three more tools appear:

| Agent call | What it gets back |
|---|---|
| `prelude_projects` | One block per project: purpose, stack, entry points, API surface, hub files, related projects |
| `prelude_locate(query="billing checkout")` | Searches every project when `project` is omitted |
| `prelude_link_projects(from="frontend", to="backend", relation="consumes", contract="REST /api/v1, JWT bearer")` | Records the relationship in frontend's `project.json` |
| `prelude_workspace_refresh` | Rebuilds the workspace index |

`prelude workspace list | index | status | remove <name>` manage the registry at `~/.prelude/` (override with `PRELUDE_HOME`).

## Keep it honest in CI

The GitHub Action has two modes. **Guard** (`check: "true"`) runs `prelude diff --check` and fails the job when the committed `.context/` has drifted from the code. **Update** (the default) runs `prelude update` and opens a pull request when `.context/` changed. Use both: guard pull requests, update on main.

```yaml
# .github/workflows/prelude.yml
name: Prelude Context
on:
  pull_request:
  push:
    branches: [main]
    paths: [package.json, pyproject.toml, Cargo.toml, go.mod, "src/**"]

jobs:
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: adjective-rob/prelude@v1
        with:
          check: "true"

  update:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
      - uses: adjective-rob/prelude@v1
```

See [action.yml](./action.yml) for the inputs (`version`, `args`, `working-directory`, `check`).

## Commands

| Command | What it does |
|---|---|
| `prelude init` | Analyze the project and write `.context/` |
| `prelude update` | Re-analyze and merge, preserving manual edits |
| `prelude diff` | Show what `update` would change, without writing |
| `prelude locate <query>` | Rank the files for a task, with tests, importers, and decisions for each |
| `prelude compact` | One dense line per section, for prompt injection |
| `prelude query` | Filter context by topic, directory, or type |
| `prelude export` | Markdown, JSON, `CLAUDE.md`, `AGENTS.md`, or `.cursorrules` |
| `prelude annotate <module>` | Set a module's purpose or notes in the map |
| `prelude decision <title>` | Log an architecture decision |
| `prelude validate` | Check `.context/` files against the JSON Schemas |
| `prelude workspace <action>` | Manage the multi-project registry |
| `prelude serve` | Run the MCP server |
| `prelude mcp-config` | Print the MCP setup for a client |
| `prelude watch` | Monitor file changes and log a work session |
| `prelude share` | Copy the context to the clipboard, with a preview |

Run any command with `--help` for its flags.

### `prelude init`

```bash
prelude init
prelude init --from-claude-md              # seed from ./CLAUDE.md
prelude init --from-claude-md docs/AI.md   # or another file
```

With `--from-claude-md`, Prelude extracts project info, stack, architecture, and constraints from the markdown and merges them with what it infers.

### `prelude update` and `prelude diff`

```bash
prelude update              # smart merge; backs up the previous state first
prelude update --dry-run    # preview
prelude update --force      # overwrite everything except decisions and changelog

prelude diff                # drift, grouped by file
prelude diff --all          # also show preserved manual edits
prelude diff --format json  # { changed, count, changes }
prelude diff --check        # exit 1 on drift
```

### `prelude locate <query...>`

Scores every file on two kinds of evidence: what the map knows (exports, paths, module purposes, architecture roles, decisions that mention the file) and a scan of file contents for the query terms, weighted so rare terms count for more. Each result lists the reasons it was picked, then an `impact` line (how many files import it, which tests cover it), the recorded `decisions` that mention it, and any module `notes`. `--format json` returns the same fields.

```bash
prelude locate billing checkout webhook
prelude locate mcp server tools --limit 3
prelude locate "query engine" --scope src/core --format json
```

| Flag | Description |
|------|-------------|
| `--limit <n>` | Maximum files to return (default 8) |
| `--scope <dir>` | Only consider files under this directory |
| `--tests` | Include test files (default: only when the query mentions tests) |
| `--format <text\|json>` | Output format (default: `text`) |

When nothing matches, Prelude prints the hub files as a place to start.

### `prelude query <topic> [options]`

```bash
prelude query "error handling"              # topic search across everything
prelude query --scope src/api/              # architecture + constraints for a directory
prelude query --type constraints            # just constraints
prelude query "prisma" --type decisions --format json
prelude query --type stack --max-tokens 500 # budget-capped output
```

| Flag | Description |
|------|-------------|
| `<topic>` | Keyword searched across all context files |
| `--scope <path>` | Architecture and constraints relevant to a directory |
| `--type <type>` | One of `project`, `stack`, `architecture`, `constraints`, `decisions`, `map` |
| `--format <md\|json>` | Output format (default: `md`) |
| `--max-tokens <n>` | Truncate output to fit a token budget |

Output goes to stdout and the token estimate to stderr, so it pipes cleanly. At least one of topic, scope, or type is required.

### `prelude export`

```bash
prelude export                      # markdown, copied to the clipboard
prelude export --format claude-md   # CLAUDE.md
prelude export --format agents-md   # AGENTS.md
prelude export --format cursorrules # .cursorrules
prelude export --format json        # structured JSON
```

The `claude-md` and `agents-md` formats include a **Read first** list of hub files and a one-line-per-module map.

### `prelude annotate <module>`

```bash
prelude annotate src/core --purpose "Inference, merge, query and export engine"
prelude annotate src/core --notes "Regex heuristics only, no AST"
prelude annotate src/core --clear-notes
```

### `prelude decision <title>`

```bash
prelude decision "Use Drizzle ORM instead of Prisma"   # opens your editor for the rationale
```

### `prelude validate`

Validates every `.context/` file against its JSON Schema and exits 1 if any fails.

### `prelude workspace <action>`

```bash
prelude workspace add . --alias backend   # register (requires .context/)
prelude workspace list
prelude workspace index                   # rebuild ~/.prelude/index.json
prelude workspace status
prelude workspace remove backend
```

## The format

Prelude is a CLI and a format. The format is specified in [spec.md](./spec.md), with a JSON Schema for every file in [`schemas/`](./schemas/README.md). The schemas ship in the npm package and allow additional properties, so you can add your own fields.

### The code map: `map.json`

Every module with a short purpose, each file's exports, the resolved internal import graph, and the **hub** files most of the codebase depends on. It is deterministic (sorted arrays, no timestamps), so it diffs cleanly in git.

```json
{
  "stats": { "files": 47, "modules": 10, "edges": 116, "unresolvedImports": 0 },
  "modules": [
    {
      "path": "src/core",
      "purpose": "Core business logic",
      "fileCount": 12,
      "files": [{ "file": "src/core/merger.ts", "lang": "ts", "lines": 349, "exports": ["ContextMerger"] }],
      "dependsOn": ["src/schema", "src/utils"],
      "tests": ["tests/merge-preserve.test.ts"]
    }
  ],
  "hubs": [{ "file": "src/utils/fs.ts", "importedBy": 18, "rank": 1 }]
}
```

### Manual edits

The `.context/` files are plain JSON. Edit them directly:

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/constraints.schema.json",
  "version": "1.0.0",
  "mustUse": ["TypeScript strict mode", "Server Components by default"],
  "preferences": [
    {
      "category": "state-management",
      "preference": "Prefer URL state over client state",
      "rationale": "Improves sharability and reduces bugs"
    }
  ]
}
```

`prelude update` keeps what you wrote and refreshes only what it inferred.

### External context directory

Set `PRELUDE_ROOT` to read and write context in a directory outside the project, for repos where you can't or don't want to commit `.context/`.

## Language support

| | Stack and architecture inference | Code map (exports, imports, hubs) |
|---|---|---|
| TypeScript / JavaScript | ✅ `package.json`, monorepos, tsconfig | ✅ including tsconfig `paths` |
| Python | ✅ `pyproject.toml`, `requirements.txt` | ✅ |
| Rust | ✅ `Cargo.toml` | ✅ |
| Go | ✅ `go.mod` | ✅ |

The format itself is language-agnostic. Adding a language to the scanner is a contained change; see [CONTRIBUTING.md](./CONTRIBUTING.md#add-a-language-to-the-code-map).

## FAQ

**Does it respect `.gitignore`?** Yes, the root `.gitignore`. Ignored files and directories stay out of the map and the architecture. Nested `.gitignore` files are not read yet.

**Should I commit `.context/`?** Yes. It is project documentation that happens to be machine-readable. Gitignore only `.context/*.session.json`.

**How often should I run `prelude update`?** After adding dependencies or restructuring. The GitHub Action does it for you and the guard mode tells you when you forgot.

**What if the inference is wrong?** It will be sometimes; it is heuristics. Edit the JSON or use `prelude annotate`. Your correction is kept on every later update. If the mistake is one Prelude should not make, [open an issue](https://github.com/adjective-rob/prelude/issues/new/choose).

**Does it send my code anywhere?** No. Inference, `locate`, and the MCP server make no network requests.

**Does it work with any LLM?** Yes. The output is text and JSON.

## Roadmap

- [ ] Graph-weighted ranking for `locate`
- [ ] An end-to-end benchmark: tokens and tool calls an agent needs to finish a task, with and without Prelude
- [ ] More languages in the code map
- [ ] Learned heuristics from agent usage

Shipped work is in the [changelog](./CHANGELOG.md). Open items are tracked in [issues](https://github.com/adjective-rob/prelude/issues).

## Contributing

Contributions are welcome, especially inference fixes for real project layouts, new framework detectors, and new languages for the code map. [CONTRIBUTING.md](./CONTRIBUTING.md) has setup, conventions, and step-by-step recipes for each. Issues labelled [`good first issue`](https://github.com/adjective-rob/prelude/labels/good%20first%20issue) are scoped to be approachable.

## License

MIT © [Adjective](https://adjective.us). See [LICENSE](./LICENSE).
