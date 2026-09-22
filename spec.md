# The Prelude Specification v1.0

**Status:** Draft  
**Last Updated:** September 2026  
**Authors:** Rob Hocking (Adjective)

---

## Abstract

Prelude is an open standard for expressing and maintaining machine-readable context about a codebase. This specification defines the structure, format, and semantics of the `.context/` directory format, enabling AI tools, agents, and teams to reason about codebases with continuity, precision, and shared understanding.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Design Principles](#design-principles)
3. [Directory Structure](#directory-structure)
4. [File Specifications](#file-specifications)
5. [Workspace](#workspace)
6. [Schema Definitions](#schema-definitions)
7. [Versioning](#versioning)
8. [Validation](#validation)
9. [Extension Points](#extension-points)
10. [Security Considerations](#security-considerations)
11. [Implementations](#implementations)

---

## 1. Introduction

### 1.1 Purpose

Modern software development increasingly involves AI-assisted coding, automated agents, and distributed teams. These systems require structured, machine-readable context about codebases to function effectively. Prelude provides a standardized format for this context.

### 1.2 Goals

- **Portability:** Context travels with the codebase
- **Discoverability:** Agents can find and parse context without prior knowledge
- **Versioning:** Context evolves alongside code
- **Extensibility:** Teams can add custom metadata
- **Simplicity:** Human-readable JSON and Markdown files

### 1.3 Non-Goals

- Replacing documentation
- Code generation
- Dependency management
- Build system integration

---

## 2. Design Principles

### 2.1 Local-First

All Prelude files MUST be stored locally in the repository. No external services are required for basic functionality.

### 2.2 Human-Readable

All files SHOULD be in JSON or Markdown format, easily readable by developers without special tools.

### 2.3 Version-Controlled

The `.context/` directory SHOULD be committed to version control alongside source code.

### 2.4 Incremental Adoption

Projects MAY implement partial Prelude support. Not all files are required.

### 2.5 Tool-Agnostic

This specification is implementation-independent. Multiple tools can read and write Prelude files.

---

## 3. Directory Structure

### 3.1 Standard Structure

```
.context/
├── project.json          # Project metadata (REQUIRED)
├── stack.json            # Technology stack (REQUIRED)
├── architecture.json     # Codebase architecture (RECOMMENDED)
├── constraints.json      # Development constraints (RECOMMENDED)
├── decisions.json        # Architectural decisions log (RECOMMENDED)
├── session.json          # AI interaction sessions (OPTIONAL)
├── map.json              # Code routing map (RECOMMENDED, GENERATED)
├── changelog.md          # Human-readable changelog (OPTIONAL)
├── export.md             # LLM-optimized export (GENERATED)
├── export.json           # Machine-readable export (GENERATED)
└── .watchlog.json        # File change events (GENERATED)
```

### 3.2 File Status

- **REQUIRED:** Must be present for valid Prelude implementation
- **RECOMMENDED:** Should be present for complete context
- **OPTIONAL:** May be present based on use case
- **GENERATED:** Created by tools, not manually edited

### 3.3 Reserved Names

The following filenames are reserved and MUST NOT be used for custom files:
- `project.json`
- `stack.json`
- `architecture.json`
- `constraints.json`
- `decisions.json`
- `session.json`
- `map.json`
- `export.md`
- `export.json`
- `.watchlog.json`

Custom files MAY be added with different names.

---

## 4. File Specifications

### 4.1 Common Fields

All JSON files SHOULD include:

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/[filename].schema.json",
  "version": "1.0.0",
  ...
}
```

- **$schema:** URI pointing to the JSON Schema for validation
- **version:** Semantic version of the Prelude format used

### 4.2 project.json

**Purpose:** Core metadata about the project.

**Required Fields:**
- `name` (string): Project name
- `description` (string): Brief project description
- `createdAt` (string): ISO 8601 datetime
- `updatedAt` (string): ISO 8601 datetime

**Optional Fields:**
- `version` (string): Project version
- `repository` (string): Repository URL
- `license` (string): License identifier
- `homepage` (string): Project homepage URL
- `team` (array): Team members
- `outputs` (array): Project deliverables
- `goals` (array): Project objectives
- `constraints` (array): High-level constraints
- `relatedProjects` (array): How this project relates to other codebases.
  Each entry has `name` (the other project's workspace name or alias),
  `relation`, and optional `contract` and `notes`.

**Relation vocabulary:**

| `relation` | Meaning |
|---|---|
| `consumes` | This project calls the other (e.g. a frontend calling an API) |
| `provides` | The other project calls this one |
| `shares-package` | This project imports the other as a dependency |
| `sibling` | Same product, no direct coupling |
| `other` | Anything else; explain in `notes` |

`contract` names the interface in a few words (`"REST /api/v1, Supabase JWT
bearer"`). `relatedProjects` is user-maintained: implementations MUST
preserve it when regenerating `project.json`.

**Example:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/project.schema.json",
  "version": "1.0.0",
  "name": "my-app",
  "description": "A modern web application",
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-15T12:00:00Z",
  "projectVersion": "2.1.0",
  "repository": "https://github.com/org/my-app",
  "license": "MIT",
  "team": [
    {
      "name": "Jane Doe",
      "role": "Tech Lead",
      "email": "jane@example.com"
    }
  ],
  "relatedProjects": [
    { "name": "backend", "relation": "consumes", "contract": "REST /api/v1, JWT bearer" }
  ]
}
```

### 4.3 stack.json

**Purpose:** Technology stack and dependencies.

**Required Fields:**
- `language` (string): Primary programming language

**Optional Fields:**
- `runtime` (string): Runtime environment
- `packageManager` (enum): Package manager (npm, pnpm, yarn, bun, pip, poetry, cargo, go)
- `framework` (string): Primary framework
- `frameworks` (array): All frameworks used
- `dependencies` (object): Production dependencies
- `devDependencies` (object): Development dependencies
- `buildTools` (array): Build and bundler tools
- `testingFrameworks` (array): Testing tools
- `styling` (array): Styling solutions
- `database` (string): Database(s) used
- `orm` (string): ORM/query builder
- `stateManagement` (string): State management solution
- `deployment` (string): Deployment platform
- `cicd` (array): CI/CD tools

**Example:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/stack.schema.json",
  "version": "1.0.0",
  "language": "TypeScript/JavaScript",
  "runtime": "Node.js 20.x",
  "packageManager": "pnpm",
  "framework": "Next.js",
  "frameworks": ["Next.js", "React"],
  "dependencies": {
    "next": "14.0.0",
    "react": "18.2.0"
  },
  "buildTools": ["Turborepo", "esbuild"],
  "testingFrameworks": ["Vitest", "Playwright"],
  "styling": ["Tailwind CSS"],
  "database": "PostgreSQL",
  "orm": "Drizzle ORM",
  "deployment": "Vercel",
  "cicd": ["GitHub Actions"]
}
```

### 4.4 architecture.json

**Purpose:** Codebase structure and patterns.

**Optional Fields:**
- `type` (enum): Project type (monolith, monorepo, microservices, library, cli, fullstack, backend, frontend)
- `directories` (array): Key directories with metadata
- `patterns` (array): Architectural patterns used
- `conventions` (array): Code conventions
- `entryPoints` (array): Application entry points
- `routing` (enum): Routing style (file-based, config-based, none)
- `stateManagement` (string): State management approach
- `apiStyle` (enum): API style (REST, GraphQL, tRPC, gRPC, mixed, none)
- `dataFlow` (string): Data flow description

**Example:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/architecture.schema.json",
  "version": "1.0.0",
  "type": "monorepo",
  "routing": "file-based",
  "apiStyle": "tRPC",
  "directories": [
    {
      "path": "apps/web",
      "purpose": "Next.js frontend application",
      "fileCount": 156
    },
    {
      "path": "packages/db",
      "purpose": "Database schema and migrations"
    }
  ],
  "patterns": [
    "Component-based architecture",
    "Custom hooks pattern",
    "Service layer"
  ],
  "conventions": [
    "Prettier code formatting",
    "ESLint code linting",
    "TypeScript strict mode"
  ],
  "entryPoints": [
    {
      "file": "apps/web/src/app/page.tsx",
      "purpose": "Main application entry"
    }
  ]
}
```

### 4.5 constraints.json

**Purpose:** Development rules and preferences.

**Optional Fields:**
- `mustUse` (array): Required technologies/practices
- `mustNotUse` (array): Prohibited technologies/practices
- `preferences` (array): Preferred approaches with rationale
- `codeStyle` (object): Code style configuration
- `naming` (object): Naming conventions
- `fileOrganization` (array): File organization rules
- `testing` (object): Testing requirements
- `documentation` (object): Documentation requirements
- `performance` (array): Performance constraints
- `security` (array): Security requirements
- `accessibility` (array): Accessibility requirements

**Example:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/constraints.schema.json",
  "version": "1.0.0",
  "mustUse": [
    "TypeScript for type safety",
    "Tailwind CSS for styling"
  ],
  "mustNotUse": [
    "Class components (use functional components)",
    "Default exports (use named exports)"
  ],
  "preferences": [
    {
      "category": "State Management",
      "preference": "Server components over client state",
      "rationale": "Reduces JavaScript bundle size and improves performance"
    }
  ],
  "codeStyle": {
    "formatter": "Prettier",
    "linter": "ESLint",
    "rules": ["eslint:recommended", "plugin:@typescript-eslint/recommended"]
  },
  "naming": {
    "components": "PascalCase",
    "files": "kebab-case",
    "functions": "camelCase"
  },
  "testing": {
    "required": true,
    "coverage": 80,
    "strategy": "Unit tests for logic, integration tests for features"
  }
}
```

### 4.6 decisions.json

**Purpose:** Log of architectural decisions (similar to ADRs).

**Structure:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/decisions.schema.json",
  "version": "1.0.0",
  "decisions": [
    {
      "id": "string",
      "timestamp": "ISO 8601 datetime",
      "title": "string",
      "status": "enum(proposed, accepted, rejected, deprecated, superseded)",
      "rationale": "string",
      "alternatives": ["array of strings"],
      "consequences": ["array of strings"],
      "impact": "string",
      "author": "string",
      "tags": ["array of strings"],
      "references": ["array of URLs"],
      "supersededBy": "decision id"
    }
  ]
}
```

**Example:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/decisions.schema.json",
  "version": "1.0.0",
  "decisions": [
    {
      "id": "1704067200000-a7b3c9d",
      "timestamp": "2025-01-01T00:00:00Z",
      "title": "Adopt Server Components as default",
      "status": "accepted",
      "rationale": "Server Components reduce client-side JavaScript and improve performance for content-heavy pages",
      "alternatives": [
        "Continue with client components",
        "Use SSR with hydration"
      ],
      "consequences": [
        "Need to refactor existing client components",
        "Team needs training on new patterns"
      ],
      "impact": "Major architectural shift affecting all new features",
      "author": "Jane Doe",
      "tags": ["architecture", "performance", "react"]
    }
  ]
}
```

### 4.7 session.json

**Purpose:** Log of AI/LLM interaction sessions.

**Structure:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/session.schema.json",
  "version": "1.0.0",
  "sessions": [
    {
      "sessionId": "string",
      "startedAt": "ISO 8601 datetime",
      "endedAt": "ISO 8601 datetime (optional)",
      "entries": [
        {
          "id": "string",
          "timestamp": "ISO 8601 datetime",
          "type": "enum(prompt, decision, refactor, debug, planning, review)",
          "summary": "string",
          "input": "string (optional)",
          "output": "string (optional)",
          "filesAffected": ["array of file paths"],
          "outcome": "enum(success, partial, failed, pending)",
          "tags": ["array of strings"]
        }
      ]
    }
  ]
}
```

### 4.8 map.json

**Purpose:** A routing index that tells an agent *where to look*: which
modules exist, what each is for, what each file exports, what depends on
what, and which files are the hubs to read first. It points at code; it
never paraphrases it.

**Required fields:** `$schema`, `version`, `stats` (`files`, `modules`,
`edges`, `unresolvedImports`), `modules`. Each module requires `path`,
`fileCount`, `files`. Each file requires `file`, `lang`, `lines`.

**Optional fields:**

- `stats.truncated` — the file cap was hit.
- Module: `purpose` (short phrase), `notes` (free text, never inferred),
  `truncated` (files capped to the highest ranked), `dependsOn`,
  `dependedOnBy` (other module paths), `tests` (test files whose imports
  resolve into the module).
- File: `exports` (max 40, in source order), `imports` (resolved internal
  targets; Go package targets end with `/`), `importedBy` (in-degree from
  non-test files), `rank` (0–1, in-degree over the maximum, with a 0.5 floor
  for declared entry points and key files), `role`, `isTest`.
- `hubs` — up to 15 most-imported files with `importedBy`, `rank`, and the
  first five `exports`.

A module path is the file's directory truncated to at most three segments.
Root-level files belong to module `.`.

**Example (trimmed):**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/map.schema.json",
  "version": "1.0.0",
  "stats": { "files": 3, "modules": 2, "edges": 2, "unresolvedImports": 0 },
  "modules": [
    {
      "path": "src/core",
      "purpose": "Core business logic",
      "notes": "Start at merger.ts for anything touching prelude update.",
      "fileCount": 2,
      "files": [
        { "file": "src/core/merger.ts", "lang": "ts", "lines": 349, "exports": ["ContextMerger"], "imports": ["src/utils/fs.ts"] },
        { "file": "src/core/query-engine.ts", "lang": "ts", "lines": 653, "exports": ["executeQuery"], "imports": ["src/utils/fs.ts"] }
      ],
      "dependsOn": ["src/utils"]
    },
    {
      "path": "src/utils",
      "purpose": "Utility functions",
      "fileCount": 1,
      "files": [
        { "file": "src/utils/fs.ts", "lang": "ts", "lines": 73, "exports": ["readJSON", "writeJSON"], "importedBy": 2, "rank": 1 }
      ],
      "dependedOnBy": ["src/core"]
    }
  ],
  "hubs": [
    { "file": "src/utils/fs.ts", "importedBy": 2, "rank": 1, "exports": ["readJSON", "writeJSON"] },
    { "file": "src/core/merger.ts", "importedBy": 1, "rank": 0.5 }
  ]
}
```

**Manual overrides:** A module's `purpose` MAY be edited by hand, and
`notes` MAY be added. Implementations MUST preserve a hand-edited `purpose`
and all `notes` when regenerating the map. Everything else is regenerated.

**Determinism:** `map.json` contains no timestamps. Every array is sorted
(modules and files by path, hubs by `importedBy` descending then path), so
regenerating an unchanged codebase produces a byte-identical file and a
changed one produces a small, reviewable diff.

### 4.9 export.md

**Purpose:** Human-readable, LLM-optimized export of all context.

**Format:** Markdown

**Structure:**

```markdown
# Project Context

> Generated by Prelude

---

## 📋 Project Overview
[Content from project.json]

## 🔧 Technology Stack
[Content from stack.json]

## 🏗️ Architecture
[Content from architecture.json]

## ⚠️ Constraints & Preferences
[Content from constraints.json]

## 🧠 Key Decisions
[Recent decisions from decisions.json]

---

*End of context export*
```

**This file is GENERATED** and should not be manually edited.

### 4.10 export.json

**Purpose:** Machine-readable export of all context.

**Structure:**

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/export.schema.json",
  "version": "1.0.0",
  "generatedAt": "ISO 8601 datetime",
  "project": { ... },
  "stack": { ... },
  "architecture": { ... },
  "constraints": { ... },
  "decisions": { ... }
}
```

**This file is GENERATED** and should not be manually edited.

---

## 5. Workspace

The workspace is an optional, **machine-local** layer on top of per-project
context. It is never committed to any repository. It lets one tool (for
example one MCP server) serve context for every codebase a developer works
on, and records how those codebases relate.

### 5.1 Location

Implementations SHOULD store workspace files in `$PRELUDE_HOME` when set,
otherwise `~/.prelude/`. The directory is created on first write, never on
read.

```
~/.prelude/
├── workspace.json   # Registry of projects (user-maintained via tooling)
└── index.json       # Generated cache over each project's .context/
```

### 5.2 workspace.json

**Purpose:** The list of registered projects.

```json
{
  "$schema": "https://adjective.us/prelude/schemas/v1/workspace.schema.json",
  "version": "1.0.0",
  "projects": [
    { "name": "backend", "path": "/home/me/code/backend", "addedAt": "2026-09-22T00:00:00Z" },
    { "name": "web-frontend", "alias": "frontend", "path": "/home/me/code/web", "addedAt": "2026-09-22T00:00:00Z" }
  ]
}
```

- `name` (REQUIRED): from the project's `project.json` `name`, else the
  directory name.
- `path` (REQUIRED): absolute path to the project root. Its context lives
  wherever the implementation resolves it (`<path>/.context` or an
  external brain directory).
- `alias` (OPTIONAL): short name used to address the project. Names and
  aliases MUST be unique, case-insensitively.
- `addedAt` (REQUIRED): ISO 8601 datetime.

### 5.3 index.json

**Purpose:** A derived summary of every registered project, so a tool can
describe all of them without reading every context file. It is a cache:
implementations MAY rebuild it at any time and SHOULD rebuild it when it is
older than `workspace.json` or any project's context files. It carries a
`generatedAt` timestamp.

Each entry summarises one project: name, alias, path, context directory,
description, architecture type, language, frameworks, package name, entry
points, API endpoints (capped) with the total count and dominant prefix,
hub files, module paths with purposes, related projects, decision count,
last context update, whether a map exists, and `missing: true` when the path
or context directory no longer exists.

`relatedProjects` in the index combines the project's own
`project.json` `relatedProjects` (listed first) with inferred
`shares-package` relations: project A depends, in its manifest, on project
B's package name.

---

## 6. Schema Definitions

### 6.1 JSON Schema

All JSON files MUST validate against their respective JSON Schema definitions.

Schemas are published at:
```
https://adjective.us/prelude/schemas/v1/project.schema.json
https://adjective.us/prelude/schemas/v1/stack.schema.json
https://adjective.us/prelude/schemas/v1/architecture.schema.json
https://adjective.us/prelude/schemas/v1/constraints.schema.json
https://adjective.us/prelude/schemas/v1/decisions.schema.json
https://adjective.us/prelude/schemas/v1/session.schema.json
https://adjective.us/prelude/schemas/v1/export.schema.json
```

### 6.2 Validation

Implementations SHOULD validate files against schemas before reading/writing.

Validation MAY be performed:
- On file write
- On file read
- Via CLI command (`prelude validate`)
- In CI/CD pipelines

---

## 7. Versioning

### 7.1 Semantic Versioning

Prelude follows Semantic Versioning 2.0.0:

- **MAJOR:** Breaking changes to file structure or required fields
- **MINOR:** New optional fields or files
- **PATCH:** Bug fixes, clarifications, non-breaking updates

### 7.2 Version Field

All JSON files MUST include a `version` field:

```json
{
  "version": "1.0.0"
}
```

### 7.3 Compatibility

Implementations MUST support files with the same MAJOR version.

Implementations SHOULD gracefully handle unknown fields (forward compatibility).

### 7.4 Migration

When MAJOR version changes occur, tools SHOULD provide migration utilities.

---

## 8. Validation

### 8.1 File Presence

A valid Prelude implementation MUST include:
- `.context/project.json`
- `.context/stack.json`

### 8.2 Schema Compliance

All JSON files MUST validate against their schemas.

### 8.3 Required Fields

Files MUST include all required fields as defined in Section 4.

### 8.4 Data Types

All fields MUST conform to their specified data types.

### 8.5 ISO 8601 Datetimes

All datetime fields MUST use ISO 8601 format with UTC timezone:
```
2025-01-15T12:00:00Z
```

---

## 9. Extension Points

### 9.1 Custom Fields

Implementations MAY add custom fields to any JSON file.

Custom fields SHOULD be namespaced:

```json
{
  "name": "my-app",
  "x-custom": {
    "internalId": "12345",
    "team": "platform"
  }
}
```

### 9.2 Custom Files

Implementations MAY add custom files to `.context/` directory.

Custom files SHOULD use prefixes to avoid conflicts:

```
.context/
├── x-custom-data.json
└── org-metrics.json
```

### 9.3 Plugins

Implementations MAY support plugin systems for extending inference or validation.

---

## 10. Security Considerations

### 10.1 Sensitive Data

`.context/` files SHOULD NOT contain:
- API keys or secrets
- Passwords or tokens
- Personal identifiable information (PII)
- Internal network topology

### 10.2 .gitignore

If `.context/` contains generated or sensitive data, relevant files MAY be added to `.gitignore`:

```
.context/.watchlog.json
.context/session.json
```

### 10.3 Validation

Implementations SHOULD validate input to prevent injection attacks.

---

## 11. Implementations

### 11.1 Reference Implementation

The reference implementation is:
- **Name:** prelude-cli
- **Language:** TypeScript
- **Repository:** https://github.com/adjective/prelude
- **License:** MIT

### 11.2 Alternative Implementations

Alternative implementations are encouraged and MAY use any language or platform.

All implementations SHOULD:
- Validate against schemas
- Support version field
- Follow this specification

### 11.3 Certification

Future versions of this spec MAY include a certification process for implementations.

---

## Appendix A: Complete Example

```
.context/
├── project.json
├── stack.json
├── architecture.json
├── constraints.json
├── decisions.json
└── export.md
```

See reference implementation for complete examples.

---

## Appendix B: Related Standards

- **JSON Schema:** https://json-schema.org/
- **Semantic Versioning:** https://semver.org/
- **ISO 8601:** https://en.wikipedia.org/wiki/ISO_8601
- **Architecture Decision Records (ADRs):** https://adr.github.io/

---

## Appendix C: Changelog

### v1.1.0 (2026-09-22)
- Added `map.json` (§4.8): code routing map with modules, exports, imports, and hubs
- Added `relatedProjects` to `project.json` (§4.2)
- Added the machine-local Workspace layer (§5)

### v1.0.0 (2025-01-15)
- Initial specification release

---

## Contributing

This specification is open source and contributions are welcome.

**Repository:** https://github.com/adjective/prelude-spec

**Process:**
1. Open an issue to discuss proposed changes
2. Submit a pull request with specification updates
3. Specification updates require consensus from maintainers

---

## License

This specification is licensed under CC BY 4.0.

Reference implementation (prelude-cli) is licensed under MIT.

---

**Prelude Specification v1.0 - November 2025**