# Task 2: Extend Architecture Schema for Source-Level Findings

## Goal

Add new optional fields to the Architecture schema (Zod + JSON Schema) so source-level scan results have a home in the `.context/architecture.json` output. These fields carry the rich context that distinguishes Prelude from a dependency manifest.

## Context

The current `Architecture` type has: `type`, `directories`, `patterns`, `conventions`, `entryPoints`, `routing`, `stateManagement`, `apiStyle`, `dataFlow`. All directory-name and config-file derived. The JSON Schema already has `"additionalProperties": true` so existing consumers won't break, but we need the Zod schema and JSON Schema to formally define the new fields so they validate, autocomplete, and format correctly downstream.

## What to Change

### File: `src/schema/architecture.ts`

Add these optional fields to `ArchitectureSchema` (the `z.object({...})` call). Insert them **after** the existing `dataFlow` field, **before** the closing `})`:

```typescript
  // Source-level findings (inferred from actual code, not just config)
  reactPatterns: z.object({
    serverComponents: z.array(z.string()).optional(),
    clientComponents: z.array(z.string()).optional(),
    serverActions: z.array(z.string()).optional(),
    hooks: z.array(z.object({
      file: z.string(),
      hooks: z.array(z.string())
    })).optional(),
    providers: z.array(z.object({
      file: z.string(),
      name: z.string(),
      contextName: z.string().optional()
    })).optional(),
    layouts: z.array(z.string()).optional()
  }).optional(),

  routes: z.array(z.object({
    file: z.string(),
    path: z.string(),
    methods: z.array(z.string()).optional(),
    isDynamic: z.boolean()
  })).optional(),

  middleware: z.array(z.object({
    file: z.string(),
    type: z.string(),
    guards: z.array(z.string()).optional()
  })).optional(),

  apiEndpoints: z.array(z.object({
    file: z.string(),
    path: z.string(),
    methods: z.array(z.string())
  })).optional(),

  keyFiles: z.array(z.object({
    file: z.string(),
    role: z.string()
  })).optional(),

  importPatterns: z.object({
    internalAliases: z.array(z.string()).optional(),
    heavyImporters: z.array(z.string()).optional()
  }).optional()
```

### File: `schemas/architecture.schema.json`

Add matching JSON Schema properties inside the `"properties"` object, **after** the existing `"dataFlow"` property. Each new property should be optional (not in `"required"`). Here are the exact additions:

```json
    "reactPatterns": {
      "type": "object",
      "description": "React-specific patterns detected from source code",
      "properties": {
        "serverComponents": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Files using 'use server' directive"
        },
        "clientComponents": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Files using 'use client' directive"
        },
        "serverActions": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Files containing server action functions"
        },
        "hooks": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["file", "hooks"],
            "properties": {
              "file": { "type": "string" },
              "hooks": { "type": "array", "items": { "type": "string" } }
            }
          },
          "description": "Custom React hooks detected"
        },
        "providers": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["file", "name"],
            "properties": {
              "file": { "type": "string" },
              "name": { "type": "string" },
              "contextName": { "type": "string" }
            }
          },
          "description": "React context providers detected"
        },
        "layouts": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Layout files (Next.js App Router)"
        }
      }
    },
    "routes": {
      "type": "array",
      "description": "Detected route files with URL paths",
      "items": {
        "type": "object",
        "required": ["file", "path", "isDynamic"],
        "properties": {
          "file": { "type": "string" },
          "path": { "type": "string" },
          "methods": { "type": "array", "items": { "type": "string" } },
          "isDynamic": { "type": "boolean" }
        }
      }
    },
    "middleware": {
      "type": "array",
      "description": "Middleware files detected",
      "items": {
        "type": "object",
        "required": ["file", "type"],
        "properties": {
          "file": { "type": "string" },
          "type": { "type": "string" },
          "guards": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "apiEndpoints": {
      "type": "array",
      "description": "API route handlers with HTTP methods",
      "items": {
        "type": "object",
        "required": ["file", "path", "methods"],
        "properties": {
          "file": { "type": "string" },
          "path": { "type": "string" },
          "methods": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "keyFiles": {
      "type": "array",
      "description": "Important files with detected roles (db connection, auth config, etc.)",
      "items": {
        "type": "object",
        "required": ["file", "role"],
        "properties": {
          "file": { "type": "string" },
          "role": { "type": "string" }
        }
      }
    },
    "importPatterns": {
      "type": "object",
      "description": "Import graph summary",
      "properties": {
        "internalAliases": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Path aliases used (e.g., @/, ~/)"
        },
        "heavyImporters": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Files with 10+ imports (complexity signals)"
        }
      }
    }
```

## Do NOT Touch

- `src/core/infer.ts` — separate task
- `src/core/source-scanner.ts` — separate task (Task 1)
- `src/core/query-engine.ts` — separate task
- `src/core/exporter.ts` — separate task
- Any other schema files (`project.ts`, `stack.ts`, `constraints.ts`, `decisions.ts`, `session.ts`)

## Verification

```bash
# Zod schema compiles
npx tsc --noEmit src/schema/architecture.ts

# JSON Schema is valid JSON
node -e "JSON.parse(require('fs').readFileSync('schemas/architecture.schema.json','utf8')); console.log('valid')"

# New fields exist in Zod schema
grep -q "reactPatterns" src/schema/architecture.ts
grep -q "apiEndpoints" src/schema/architecture.ts
grep -q "keyFiles" src/schema/architecture.ts
grep -q "importPatterns" src/schema/architecture.ts
grep -q "middleware" src/schema/architecture.ts
grep -q "routes" src/schema/architecture.ts

# New fields exist in JSON Schema
node -e "const s=JSON.parse(require('fs').readFileSync('schemas/architecture.schema.json','utf8')); const p=s.properties; console.log('reactPatterns:', !!p.reactPatterns, 'routes:', !!p.routes, 'middleware:', !!p.middleware, 'apiEndpoints:', !!p.apiEndpoints, 'keyFiles:', !!p.keyFiles, 'importPatterns:', !!p.importPatterns)"

# All new fields are optional (not in required array, and Zod has .optional())
grep -c "\.optional()" src/schema/architecture.ts  # count should increase by 6+ from current
```
