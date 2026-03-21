# Task 1: Create `src/core/source-scanner.ts` — Source-Level Heuristic Scanner

## Goal

Create a new module that reads actual source files (not just config/package.json) and returns structured findings about how the codebase works. This is the foundation that later tasks will consume.

## Context

Currently `src/core/infer.ts` only reads `package.json`, config files, and directory names. It knows "this project uses React" but can't tell you "this project uses React Server Components with the App Router, auth is in middleware.ts, and there's a Supabase auth provider at src/providers/auth.tsx." This module fills that gap with lightweight grep/regex heuristics — no AST parsing, no heavy dependencies.

## What to Create

**File:** `src/core/source-scanner.ts`

**Exported interface:**

```typescript
export interface SourceScanResult {
  // React/Next.js patterns
  reactPatterns: {
    serverComponents: string[];   // files containing "use server"
    clientComponents: string[];   // files containing "use client"
    serverActions: string[];      // files exporting server action functions
    hooks: HookInfo[];            // custom hooks found (file + hook names)
    providers: ProviderInfo[];    // context providers (file + context name)
    layouts: string[];            // layout.tsx files (Next.js App Router)
  };

  // Routing
  routes: RouteInfo[];            // detected route files with HTTP methods

  // Middleware
  middleware: MiddlewareInfo[];    // middleware files and what they guard

  // API surface
  apiEndpoints: APIEndpointInfo[]; // detected API routes with methods

  // Key files
  keyFiles: KeyFileInfo[];        // env config, db connections, auth setup, etc.

  // Import graph summary
  importPatterns: {
    internalAliases: string[];    // e.g., "@/", "~/", "#"
    heavyImporters: string[];     // files with 10+ imports (complexity signals)
  };
}

export interface HookInfo {
  file: string;
  hooks: string[];  // e.g., ["useAuth", "useUser"]
}

export interface ProviderInfo {
  file: string;
  name: string;     // e.g., "AuthProvider", "ThemeContext"
  contextName?: string; // the createContext variable name if detectable
}

export interface RouteInfo {
  file: string;
  path: string;      // inferred URL path from file location
  methods?: string[]; // GET, POST, etc. if detectable
  isDynamic: boolean; // contains [param] segments
}

export interface MiddlewareInfo {
  file: string;
  type: string;      // "Next.js middleware" | "Express middleware" | "custom"
  guards?: string[];  // path matchers if detectable from config
}

export interface APIEndpointInfo {
  file: string;
  path: string;
  methods: string[];
}

export interface KeyFileInfo {
  file: string;
  role: string;  // "database connection", "auth config", "env config", etc.
}
```

**Exported function:**

```typescript
export async function scanSources(rootDir: string): Promise<SourceScanResult>
```

## Implementation Details

### File discovery

Use the existing `getDirectoryTree` from `src/utils/fs.ts` (depth 4) to find directories. Then scan for `.ts`, `.tsx`, `.js`, `.jsx` files within them. **Skip** `node_modules`, `.next`, `dist`, `build`, `.git`, `.context`, and any path matching `IGNORE_PATTERNS` from `src/constants.ts`.

Read files with `fs/promises` `readFile`. For each file, only read the **first 100 lines** (or first 4KB, whichever is less) to keep it fast. Most directives and imports are at the top of files.

### Detection heuristics (regex-based, not AST)

**React patterns:**
- `"use client"` or `'use client'` as first non-comment line → `clientComponents`
- `"use server"` or `'use server'` as first non-comment line → `serverComponents`
- `"use server"` inside a function body (not at file top) → `serverActions` (file-level signal only)
- Files exporting functions matching `^use[A-Z]` → custom hooks. Regex: `export\s+(default\s+)?function\s+(use[A-Z]\w+)` and `export\s+const\s+(use[A-Z]\w+)`
- Files containing `createContext` → providers. Regex: `createContext[<(]` to find context creation, then look for `export.*Provider` or `export.*Context` in same file
- Files named `layout.tsx` or `layout.ts` in `app/` directories → layouts

**Routing (Next.js App Router):**
- Files matching `app/**/page.tsx` or `app/**/page.ts` → routes. Infer URL path by stripping `app/` prefix and `/page.tsx` suffix. Replace `[param]` with `:param` for readability. Mark `isDynamic: true` if path contains `[`.
- Files matching `app/**/route.ts` or `app/**/route.tsx` → API endpoints. Scan for exported function names: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`. Regex: `export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)`

**Routing (Pages Router / Express):**
- Files in `pages/api/**` → API endpoints. Method is usually `req.method` checked internally — just note the file and path.
- Files containing `router.get(`, `router.post(`, `app.get(`, `app.post(` etc. → config-based routes. Regex: `(?:router|app)\.(get|post|put|patch|delete)\s*\(` — collect methods per file.

**Middleware:**
- File named `middleware.ts` or `middleware.js` at project root or `src/` → Next.js middleware. Look for `export const config = { matcher:` and extract the matcher array values if present. Regex: `matcher\s*:\s*\[(.*?)\]` (single-line match is fine).
- Files in a `middleware/` directory → custom middleware. Role = filename stem.

**Key files:**
- `src/lib/db.*` or `src/db.*` or `db/index.*` or files containing `drizzle(` or `new PrismaClient` or `createClient` (Supabase) → role: "database connection"
- `src/lib/auth.*` or `src/auth.*` or files importing from `next-auth` or `@clerk` or `lucia` or `@supabase/auth-helpers` → role: "auth config"
- `next.config.*` or `vite.config.*` or `nuxt.config.*` → role: "framework config"
- Files named `env.*` or containing `process.env.` heavily (5+ occurrences) → role: "env config"

**Import patterns:**
- Scan import statements for path aliases. Regex: `from\s+['"](@\/|~\/|#)` — collect unique alias prefixes into `internalAliases`.
- Count imports per file. Regex: `^import\s` (line start). Files with 10+ import lines → `heavyImporters`.

### Performance constraints

- **No new dependencies.** Use only `fs/promises`, `path`, and built-in Node.js modules.
- **Read first 100 lines / 4KB per file** — whichever limit hits first.
- **Skip binary files** — if a file starts with non-UTF8 bytes, skip it.
- **Timeout: scan should complete in <2 seconds** for a 500-file project. Don't read files you don't need to. Only scan `.ts`, `.tsx`, `.js`, `.jsx` extensions.

### Error handling

- Wrap each file read in try/catch. A single unreadable file should not abort the scan.
- Return empty arrays for any category that finds nothing.

## Do NOT Touch

- `src/core/infer.ts` — do not modify (separate task)
- `src/schema/` — do not modify (separate task)
- Any existing files — this task is additive only

## Verification

After implementation, verify:

```bash
# File exists and compiles
npx tsc --noEmit src/core/source-scanner.ts

# Exported function signature is correct
grep -q "export async function scanSources" src/core/source-scanner.ts

# Exported interface exists
grep -q "export interface SourceScanResult" src/core/source-scanner.ts

# No new dependencies added
grep -c "from '\." src/core/source-scanner.ts  # should only import from local modules
```

Run the scanner against the Prelude repo itself as a smoke test:

```typescript
import { scanSources } from './src/core/source-scanner.js';
const result = await scanSources(process.cwd());
console.log(JSON.stringify(result, null, 2));
```

It should find:
- The `bin/prelude.ts` entry point patterns
- Import aliases (if any)
- TypeScript files in `src/`
- No React patterns (since Prelude itself is a CLI, not a React app)
