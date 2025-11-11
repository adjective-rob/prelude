# Prelude

> The open standard for expressing and maintaining **machine-readable context** about a codebase.

Prelude provides a structured `.context/` directory format that enables **AI tools, agents, and human teams** to reason with continuity, precision, and shared understanding.

The vision is that every serious project will eventually have a `.context/` directory, just as it has a `package.json` or `.git/` folder.

-----

## Product Philosophy

| Pillar | Description |
| :--- | :--- |
| **Context is the Runtime** | Developers and AI agents require structured memory, and Prelude provides the universal format. |
| **Format Over Tooling** | Prelude is primarily a spec. The core value and moat are in the adoption of the `.context/` format itself. |
| **Local-First, Open by Design** | Runs entirely offline to support robust, offline-first LLM workflows. |
| **Agent-Native** | Every file is designed to be easily parsed, evaluated, or mutated by software agents. |

-----

## The `.context/` Standard

The `.context/` folder contains modular, parseable files representing high-signal context:

| File | Description |
| :--- | :--- |
| **`project.json`** | Defines project purpose, team roles, major constraints, and final outputs. |
| **`stack.json`** | Auto-detected tools, frameworks, dependencies (e.g., Node.js, React, Vitest). |
| **`architecture.json`** | Describes the directory map, key flows, naming patterns, and API style (REST/GraphQL/tRPC). |
| **`constraints.json`** | Explicit rules, "must-use" declarations, code style (ESLint/Prettier), and testing strategy. |
| **`decisions.json`** | A timestamped log of architectural tradeoffs and their rationales (ADRs). |
| **`export.md / .json`** | The final AI-optimized, compressed summary of all context files, ready for prompting. |
| **`changelog.md`** | Human- or AI-generated history of the codebase. |
| **`session.json`** | (Optional) Logs recent AI interactions or planning traces. |

-----

## Quick Start

Use the CLI to start managing your project context.

```bash
# Install dependencies
pnpm install

# 1. Initialize Prelude in your project
# Scaffolds .context/ and infers initial metadata (project, stack, architecture, constraints)
pnpm prelude init

# 2. Log a decision
# Record an important architectural choice with a rationale
pnpm prelude decision "Adopted CAC for CLI" --rationale "It's lightweight and modern"

# 3. Export context for LLM consumption
# Generates the final, combined .context/export.md file
pnpm prelude export

# 4. Copy directly to clipboard
# Reads the export.md and copies to clipboard for easy pasting into an AI chat
pnpm prelude share
```

### All Commands

| Command | Purpose | Options |
| :--- | :--- | :--- |
| `prelude init` | **Scaffold** `.context/` with inferred metadata. | `--force` to overwrite existing directory. |
| `prelude export` | Generate LLM-optimized context export. | `--format <md\|json>` (default: `md`). |
| `prelude decision` | Log a timestamped architectural decision. | `--rationale <text>`, `--alternatives <items>`, `--impact <text>`, `--status <status>`. |
| `prelude watch` | **Track changes** in codebase files (`src/`, `package.json`, etc.) and automatically update context files. | `--once` to run updates once and exit. |
| `prelude share` | Quick copy of the `export.md` content to clipboard with a preview. | `--format <md\|json>` (default: `md`). |

-----

## Project Details

  - **Language:** TypeScript (Node.js, ESM)
  - **Package Manager:** `pnpm`
  - **CLI Framework:** `cac`
  - **Schema Validation:** `zod` for runtime validation and type-safe data structures.
  - **File Watcher:** `chokidar` for efficient change detection.
  - **Testing:** `vitest`.

  ## Specification

See [SPEC.md](./SPEC.md) for the complete Prelude format specification.

### License

This project is licensed under the **MIT License**.