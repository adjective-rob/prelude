# Task 3: Wire Source Scanner into `inferArchitecture`

## Goal

Call `scanSources()` from within `inferArchitecture()` in `src/core/infer.ts` and merge the results into the Architecture output. This is where source-level findings enter the existing pipeline.

## Context

After Tasks 1 and 2 are complete:
- `src/core/source-scanner.ts` exports `scanSources(rootDir)` returning a `SourceScanResult`
- `src/schema/architecture.ts` defines optional fields: `reactPatterns`, `routes`, `middleware`, `apiEndpoints`, `keyFiles`, `importPatterns`
- `inferArchitecture()` in `src/core/infer.ts` currently only inspects directory names, config files, and package.json

This task wires them together.

## What to Change

### File: `src/core/infer.ts`

**1. Add import** at the top of the file, after the existing imports (line ~5):

```typescript
import { scanSources } from './source-scanner.js';
```

The exact line to add this after is:
```
import type { Project, Stack, Architecture, Constraints } from '../schema/index.js';
```

**2. Call scanSources inside `inferArchitecture`**

Inside the `inferArchitecture` function, **after** the `architecture.entryPoints = entryPoints;` line (near the end of the function, just before `return architecture as Architecture;`), add:

```typescript
  // --- Source-level scanning ---
  try {
    const scanResult = await scanSources(rootDir);

    // Only include non-empty findings
    if (scanResult.reactPatterns.serverComponents.length > 0 ||
        scanResult.reactPatterns.clientComponents.length > 0 ||
        scanResult.reactPatterns.hooks.length > 0 ||
        scanResult.reactPatterns.providers.length > 0 ||
        scanResult.reactPatterns.layouts.length > 0 ||
        scanResult.reactPatterns.serverActions.length > 0) {
      const rp: Record<string, unknown> = {};
      if (scanResult.reactPatterns.serverComponents.length > 0) rp.serverComponents = scanResult.reactPatterns.serverComponents;
      if (scanResult.reactPatterns.clientComponents.length > 0) rp.clientComponents = scanResult.reactPatterns.clientComponents;
      if (scanResult.reactPatterns.serverActions.length > 0) rp.serverActions = scanResult.reactPatterns.serverActions;
      if (scanResult.reactPatterns.hooks.length > 0) rp.hooks = scanResult.reactPatterns.hooks;
      if (scanResult.reactPatterns.providers.length > 0) rp.providers = scanResult.reactPatterns.providers;
      if (scanResult.reactPatterns.layouts.length > 0) rp.layouts = scanResult.reactPatterns.layouts;
      (architecture as any).reactPatterns = rp;
    }

    if (scanResult.routes.length > 0) {
      (architecture as any).routes = scanResult.routes;
    }

    if (scanResult.middleware.length > 0) {
      (architecture as any).middleware = scanResult.middleware;
    }

    if (scanResult.apiEndpoints.length > 0) {
      (architecture as any).apiEndpoints = scanResult.apiEndpoints;
    }

    if (scanResult.keyFiles.length > 0) {
      (architecture as any).keyFiles = scanResult.keyFiles;
    }

    if (scanResult.importPatterns.internalAliases.length > 0 ||
        scanResult.importPatterns.heavyImporters.length > 0) {
      const ip: Record<string, unknown> = {};
      if (scanResult.importPatterns.internalAliases.length > 0) ip.internalAliases = scanResult.importPatterns.internalAliases;
      if (scanResult.importPatterns.heavyImporters.length > 0) ip.heavyImporters = scanResult.importPatterns.heavyImporters;
      (architecture as any).importPatterns = ip;
    }

    // Enrich existing patterns array with source-level findings
    if (scanResult.reactPatterns.serverComponents.length > 0 ||
        scanResult.reactPatterns.clientComponents.length > 0) {
      if (!architecture.patterns) architecture.patterns = [];
      if (!architecture.patterns.includes('React Server Components')) {
        architecture.patterns.push('React Server Components');
      }
    }
    if (scanResult.reactPatterns.serverActions.length > 0) {
      if (!architecture.patterns) architecture.patterns = [];
      if (!architecture.patterns.includes('Server Actions')) {
        architecture.patterns.push('Server Actions');
      }
    }
  } catch (error) {
    // Source scanning is best-effort — don't fail inference if it errors
    // The architecture result will just lack source-level fields
  }
```

**3. Also enrich `inferArchitecture`'s existing pattern detection** with source-level signals.

Currently the patterns array is built from directory names only. The code block above already adds 'React Server Components' and 'Server Actions' to patterns when detected. No further changes needed to the existing patterns detection — we're augmenting, not replacing.

## Do NOT Touch

- `src/core/source-scanner.ts` — built in Task 1
- `src/schema/` — modified in Task 2
- `inferProjectMetadata()` — leave as-is
- `inferStack()` — leave as-is
- `inferConstraints()` — leave as-is
- The existing logic in `inferArchitecture()` — only append to the end, don't modify existing detection logic
- `src/core/query-engine.ts` — separate task
- `src/core/exporter.ts` — separate task

## Verification

```bash
# Compiles without errors
npx tsc --noEmit

# Import is present
grep -q "import { scanSources } from './source-scanner.js'" src/core/infer.ts

# scanSources is called inside inferArchitecture
grep -q "scanSources(rootDir)" src/core/infer.ts

# Source scanning is wrapped in try/catch (best-effort)
grep -A2 "scanSources(rootDir)" src/core/infer.ts | grep -q "catch"
```

Run `prelude init` in any project directory and inspect `.context/architecture.json` — the new fields should appear if the project has relevant source patterns. For a plain Node.js project with no React, the fields should be absent (not empty arrays).
