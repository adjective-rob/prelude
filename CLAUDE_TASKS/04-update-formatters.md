# Task 4: Update Formatters to Surface Source-Level Findings

## Goal

Update the three output paths — markdown export, query engine markdown, and compact format — so that source-level findings from `architecture.json` actually appear in Prelude's output. Without this, the scanner runs but agents never see the results.

## Context

After Tasks 1–3, `architecture.json` now contains optional fields: `reactPatterns`, `routes`, `middleware`, `apiEndpoints`, `keyFiles`, `importPatterns`. Three formatters need to know about them:

1. **`src/core/exporter.ts`** → `exportToMarkdown()` — the `prelude export` output
2. **`src/core/query-engine.ts`** → `formatArchitectureSection()` — the `prelude query` markdown output
3. **`src/core/query-engine.ts`** → `formatCompactArchitecture()` — the `prelude compact` output

All three currently only format the old fields (type, routing, patterns, directories, etc.).

## What to Change

### File 1: `src/core/exporter.ts`

In the `exportToMarkdown()` function, find the Architecture section. It currently ends after the `directories` block with `markdown += '---\\n\\n';`. **Before** that closing `---`, insert the following blocks. Each block is guarded by a length/existence check so it only appears when data exists.

Find this exact string in the architecture section:

```typescript
    markdown += '---\n\n';
  }
  
  // Constraints
```

Replace it with:

```typescript
    // Source-level findings
    if ((arch as any).routes && (arch as any).routes.length > 0) {
      markdown += '**Routes:**\n';
      (arch as any).routes.forEach((r: any) => {
        const methods = r.methods ? ` [${r.methods.join(', ')}]` : '';
        const dynamic = r.isDynamic ? ' (dynamic)' : '';
        markdown += `- \`${r.path}\`${methods}${dynamic} → \`${r.file}\`\n`;
      });
      markdown += '\n';
    }

    if ((arch as any).apiEndpoints && (arch as any).apiEndpoints.length > 0) {
      markdown += '**API Endpoints:**\n';
      (arch as any).apiEndpoints.forEach((ep: any) => {
        markdown += `- \`${ep.methods.join(', ')} ${ep.path}\` → \`${ep.file}\`\n`;
      });
      markdown += '\n';
    }

    if ((arch as any).middleware && (arch as any).middleware.length > 0) {
      markdown += '**Middleware:**\n';
      (arch as any).middleware.forEach((m: any) => {
        const guards = m.guards && m.guards.length > 0 ? ` (guards: ${m.guards.join(', ')})` : '';
        markdown += `- \`${m.file}\` — ${m.type}${guards}\n`;
      });
      markdown += '\n';
    }

    if ((arch as any).reactPatterns) {
      const rp = (arch as any).reactPatterns;
      const parts: string[] = [];
      if (rp.serverComponents?.length) parts.push(`${rp.serverComponents.length} server components`);
      if (rp.clientComponents?.length) parts.push(`${rp.clientComponents.length} client components`);
      if (rp.serverActions?.length) parts.push(`${rp.serverActions.length} server action files`);
      if (rp.layouts?.length) parts.push(`${rp.layouts.length} layouts`);
      if (parts.length > 0) {
        markdown += `**React Patterns:** ${parts.join(', ')}\n`;
      }
      if (rp.hooks?.length) {
        markdown += '**Custom Hooks:**\n';
        rp.hooks.forEach((h: any) => {
          markdown += `- \`${h.file}\`: ${h.hooks.join(', ')}\n`;
        });
      }
      if (rp.providers?.length) {
        markdown += '**Providers:**\n';
        rp.providers.forEach((p: any) => {
          markdown += `- \`${p.file}\`: ${p.name}\n`;
        });
      }
      markdown += '\n';
    }

    if ((arch as any).keyFiles && (arch as any).keyFiles.length > 0) {
      markdown += '**Key Files:**\n';
      (arch as any).keyFiles.forEach((kf: any) => {
        markdown += `- \`${kf.file}\` — ${kf.role}\n`;
      });
      markdown += '\n';
    }

    markdown += '---\n\n';
  }
  
  // Constraints
```

### File 2: `src/core/query-engine.ts` — `formatArchitectureSection()`

Find the `formatArchitectureSection` function. It currently ends with:

```typescript
  md += '\n';
  return md;
}
```

**Before** the `md += '\n';` at the end of the function, insert:

```typescript
  // Source-level findings
  const archAny = arch as any;
  if (archAny.routes?.length) {
    md += '**Routes:**\n';
    archAny.routes.forEach((r: any) => {
      const methods = r.methods ? ` [${r.methods.join(', ')}]` : '';
      md += `- \`${r.path}\`${methods} → \`${r.file}\`\n`;
    });
  }
  if (archAny.apiEndpoints?.length) {
    md += '**API Endpoints:**\n';
    archAny.apiEndpoints.forEach((ep: any) => {
      md += `- \`${ep.methods.join(', ')} ${ep.path}\` → \`${ep.file}\`\n`;
    });
  }
  if (archAny.middleware?.length) {
    md += '**Middleware:**\n';
    archAny.middleware.forEach((m: any) => {
      const guards = m.guards?.length ? ` (guards: ${m.guards.join(', ')})` : '';
      md += `- \`${m.file}\` — ${m.type}${guards}\n`;
    });
  }
  if (archAny.reactPatterns) {
    const rp = archAny.reactPatterns;
    const parts: string[] = [];
    if (rp.serverComponents?.length) parts.push(`${rp.serverComponents.length} server components`);
    if (rp.clientComponents?.length) parts.push(`${rp.clientComponents.length} client components`);
    if (rp.hooks?.length) parts.push(`${rp.hooks.length} custom hooks`);
    if (rp.providers?.length) parts.push(`${rp.providers.length} providers`);
    if (parts.length > 0) md += `**React Patterns:** ${parts.join(', ')}\n`;
  }
  if (archAny.keyFiles?.length) {
    md += '**Key Files:**\n';
    archAny.keyFiles.forEach((kf: any) => {
      md += `- \`${kf.file}\` — ${kf.role}\n`;
    });
  }
```

### File 3: `src/core/query-engine.ts` — `formatCompactArchitecture()`

Find the `formatCompactArchitecture` function. It currently builds a `parts` array and returns a formatted string. **After** the existing `dirs:` block (the last `if` before `return`), add:

```typescript
  // Source-level compact summaries
  const archAny = data as any;
  if (archAny.routes?.length) {
    const routePaths = archAny.routes.map((r: any) => {
      const methods = r.methods ? `[${r.methods.join(',')}]` : '';
      return `${r.path}${methods}`;
    });
    parts.push('routes: ' + routePaths.join(', '));
  }
  if (archAny.apiEndpoints?.length) {
    const eps = archAny.apiEndpoints.map((ep: any) => `${ep.methods.join(',')} ${ep.path}`);
    parts.push('api: ' + eps.join(', '));
  }
  if (archAny.middleware?.length) {
    const mw = archAny.middleware.map((m: any) => m.file);
    parts.push('middleware: ' + mw.join(', '));
  }
  if (archAny.reactPatterns) {
    const rp = archAny.reactPatterns;
    const rpParts: string[] = [];
    if (rp.serverComponents?.length) rpParts.push(`${rp.serverComponents.length} server`);
    if (rp.clientComponents?.length) rpParts.push(`${rp.clientComponents.length} client`);
    if (rp.hooks?.length) rpParts.push(`${rp.hooks.length} hooks`);
    if (rp.providers?.length) rpParts.push(`${rp.providers.length} providers`);
    if (rpParts.length > 0) parts.push('react: ' + rpParts.join(', '));
  }
  if (archAny.keyFiles?.length) {
    const kf = archAny.keyFiles.map((k: any) => `${k.file}(${k.role})`);
    parts.push('key-files: ' + kf.join(', '));
  }
```

## Do NOT Touch

- `src/core/source-scanner.ts` — built in Task 1
- `src/schema/` — modified in Task 2
- `src/core/infer.ts` — modified in Task 3
- `formatProjectSection`, `formatStackSection`, `formatConstraintsSection`, `formatDecisionsSection` — don't modify
- `formatCompactProject`, `formatCompactStack`, `formatCompactConstraints`, `formatCompactDecisions` — don't modify
- The `executeQuery` or `exportCompact` orchestration functions — don't modify (they pass data through generically)

## Verification

```bash
# Compiles
npx tsc --noEmit

# exporter.ts has route formatting
grep -q "Routes:" src/core/exporter.ts
grep -q "API Endpoints:" src/core/exporter.ts
grep -q "Key Files:" src/core/exporter.ts

# query-engine.ts formatArchitectureSection has new fields
grep -q "archAny.routes" src/core/query-engine.ts
grep -q "archAny.apiEndpoints" src/core/query-engine.ts
grep -q "archAny.keyFiles" src/core/query-engine.ts

# query-engine.ts formatCompactArchitecture has new fields
grep -q "'routes: '" src/core/query-engine.ts
grep -q "'api: '" src/core/query-engine.ts
grep -q "'key-files: '" src/core/query-engine.ts
```

**End-to-end test:** Run `prelude init && prelude export --print` in a Next.js project (or any project with React patterns). The export should now show Routes, API Endpoints, Middleware, React Patterns, and Key Files sections within the Architecture block. Run `prelude compact` — the `[arch]` line should include `routes:`, `api:`, `react:`, `key-files:` segments.
