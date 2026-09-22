# Task 5: Tests for Source Scanner

## Goal

Write tests for `src/core/source-scanner.ts` that verify each detection heuristic works correctly using fixture files on disk. This ensures the regex patterns actually match real-world code and don't regress.

## Context

`source-scanner.ts` (Task 1) uses regex heuristics to detect React patterns, routes, middleware, API endpoints, key files, and import patterns. Each heuristic needs at least one positive and one negative test case. Tests use Vitest (already in devDependencies).

## What to Create

### File: `tests/source-scanner.test.ts`

Create a test file that:

1. **Sets up a temporary fixture directory** in `beforeAll` using `fs/promises` `mkdtemp` in `os.tmpdir()`. Cleans up in `afterAll` with `rm -rf`.

2. **Creates fixture files** that exercise each detection path. The fixtures should be minimal — just enough code to trigger (or not trigger) each heuristic.

### Required Fixture Files and Test Cases

**React Server Components / Client Components:**
```
fixtures/app/page.tsx        → contains "use client" at top → detected as clientComponent
fixtures/app/actions.ts      → contains "use server" at top → detected as serverComponent
fixtures/app/plain.ts        → no directive → not in either list
```

**Custom Hooks:**
```
fixtures/src/hooks/useAuth.ts → exports `export function useAuth()` and `export const useUser`
                                → detected with hooks: ["useAuth", "useUser"]
fixtures/src/utils/helper.ts  → exports `export function formatDate()` → NOT detected as hook
```

**Providers:**
```
fixtures/src/providers/auth.tsx → contains `createContext<` and `export function AuthProvider`
                                  → detected with name: "AuthProvider"
fixtures/src/components/Button.tsx → regular component, no createContext → NOT detected
```

**Routes (Next.js App Router):**
```
fixtures/app/page.tsx            → route path: "/" (already created above)
fixtures/app/dashboard/page.tsx  → route path: "/dashboard"
fixtures/app/users/[id]/page.tsx → route path: "/users/:id", isDynamic: true
```

**API Endpoints (Next.js Route Handlers):**
```
fixtures/app/api/users/route.ts → contains `export async function GET` and `export async function POST`
                                  → methods: ["GET", "POST"], path: "/api/users"
```

**Express-style Routes:**
```
fixtures/src/routes/items.ts → contains `router.get('/items'` and `router.post('/items'`
                               → methods: ["get", "post"]
```

**Middleware:**
```
fixtures/middleware.ts → contains `export function middleware` and `export const config = { matcher: ['/dashboard/:path*'] }`
                        → type: "Next.js middleware", guards: ["/dashboard/:path*"]
```

**Key Files:**
```
fixtures/src/lib/db.ts   → contains `drizzle(` → role: "database connection"
fixtures/src/lib/auth.ts → contains `import { ... } from 'next-auth'` → role: "auth config"
```

**Import Patterns:**
```
fixtures/src/components/Complex.tsx → 12 import lines, uses `from '@/lib/...'`
                                     → internalAliases includes "@/", heavyImporters includes this file
fixtures/src/utils/simple.ts       → 3 import lines → NOT in heavyImporters
```

### Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanSources } from '../src/core/source-scanner.js';

let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'prelude-test-'));
  // Create all fixture files here
  // Use await mkdir(..., { recursive: true }) for nested dirs
  // Use await writeFile(...) for each fixture
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe('scanSources', () => {

  describe('React patterns', () => {
    it('detects "use client" directive', async () => {
      const result = await scanSources(fixtureDir);
      expect(result.reactPatterns.clientComponents).toContain('app/page.tsx');
    });

    it('detects "use server" directive', async () => {
      const result = await scanSources(fixtureDir);
      expect(result.reactPatterns.serverComponents).toContain('app/actions.ts');
    });

    it('detects custom hooks', async () => {
      const result = await scanSources(fixtureDir);
      const authHook = result.reactPatterns.hooks.find(h => h.file.includes('useAuth'));
      expect(authHook).toBeDefined();
      expect(authHook!.hooks).toContain('useAuth');
      expect(authHook!.hooks).toContain('useUser');
    });

    it('does not detect non-hook exports as hooks', async () => {
      const result = await scanSources(fixtureDir);
      const helperHook = result.reactPatterns.hooks.find(h => h.file.includes('helper'));
      expect(helperHook).toBeUndefined();
    });

    it('detects context providers', async () => {
      const result = await scanSources(fixtureDir);
      const authProvider = result.reactPatterns.providers.find(p => p.name === 'AuthProvider');
      expect(authProvider).toBeDefined();
    });

    it('detects layout files', async () => {
      // Need to create a layout fixture in beforeAll too
      const result = await scanSources(fixtureDir);
      // layouts should include any layout.tsx found in app/
      expect(result.reactPatterns.layouts.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Routes', () => {
    it('detects Next.js App Router pages', async () => {
      const result = await scanSources(fixtureDir);
      const dashRoute = result.routes.find(r => r.path === '/dashboard');
      expect(dashRoute).toBeDefined();
      expect(dashRoute!.isDynamic).toBe(false);
    });

    it('detects dynamic route segments', async () => {
      const result = await scanSources(fixtureDir);
      const userRoute = result.routes.find(r => r.path.includes('users'));
      expect(userRoute).toBeDefined();
      expect(userRoute!.isDynamic).toBe(true);
    });
  });

  describe('API Endpoints', () => {
    it('detects route handler HTTP methods', async () => {
      const result = await scanSources(fixtureDir);
      const usersApi = result.apiEndpoints.find(ep => ep.path.includes('/api/users'));
      expect(usersApi).toBeDefined();
      expect(usersApi!.methods).toContain('GET');
      expect(usersApi!.methods).toContain('POST');
    });
  });

  describe('Middleware', () => {
    it('detects Next.js middleware with matchers', async () => {
      const result = await scanSources(fixtureDir);
      expect(result.middleware.length).toBeGreaterThan(0);
      const mw = result.middleware[0];
      expect(mw.type).toBe('Next.js middleware');
      expect(mw.guards).toContain("/dashboard/:path*");
    });
  });

  describe('Key Files', () => {
    it('detects database connection files', async () => {
      const result = await scanSources(fixtureDir);
      const dbFile = result.keyFiles.find(kf => kf.role === 'database connection');
      expect(dbFile).toBeDefined();
    });

    it('detects auth config files', async () => {
      const result = await scanSources(fixtureDir);
      const authFile = result.keyFiles.find(kf => kf.role === 'auth config');
      expect(authFile).toBeDefined();
    });
  });

  describe('Import Patterns', () => {
    it('detects path aliases', async () => {
      const result = await scanSources(fixtureDir);
      expect(result.importPatterns.internalAliases).toContain('@/');
    });

    it('detects heavy importers', async () => {
      const result = await scanSources(fixtureDir);
      expect(result.importPatterns.heavyImporters.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('returns empty results for empty directory', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'prelude-empty-'));
      try {
        const result = await scanSources(emptyDir);
        expect(result.reactPatterns.clientComponents).toEqual([]);
        expect(result.routes).toEqual([]);
        expect(result.apiEndpoints).toEqual([]);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('handles unreadable files gracefully', async () => {
      // scanSources should not throw even if individual files fail
      const result = await scanSources(fixtureDir);
      expect(result).toBeDefined();
    });
  });
});
```

### Fixture Content Examples

Here is the content for key fixture files. Write these in `beforeAll`:

**`app/page.tsx`:**
```typescript
"use client"
import React from 'react';
export default function Home() { return <div>Home</div>; }
```

**`app/actions.ts`:**
```typescript
"use server"
export async function createUser(data: FormData) { }
```

**`app/api/users/route.ts`:**
```typescript
export async function GET(request: Request) { return Response.json([]); }
export async function POST(request: Request) { return Response.json({}); }
```

**`src/hooks/useAuth.ts`:**
```typescript
import { useState } from 'react';
export function useAuth() { return { user: null }; }
export const useUser = () => { return null; };
```

**`src/providers/auth.tsx`:**
```typescript
import { createContext, useContext } from 'react';
const AuthContext = createContext<any>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <AuthContext.Provider value={{}}>{children}</AuthContext.Provider>;
}
```

**`middleware.ts`:**
```typescript
import { NextResponse } from 'next/server';
export function middleware(request: any) { return NextResponse.next(); }
export const config = { matcher: ['/dashboard/:path*'] };
```

**`src/lib/db.ts`:**
```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
export const db = drizzle(process.env.DATABASE_URL!);
```

**`src/lib/auth.ts`:**
```typescript
import NextAuth from 'next-auth';
export const { handlers, auth } = NextAuth({ providers: [] });
```

**`src/components/Complex.tsx`** (12+ imports to trigger heavyImporters):
```typescript
import React from 'react';
import { useState } from 'react';
import { useEffect } from 'react';
import { useCallback } from 'react';
import { useMemo } from 'react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/utils/helper';
import { db } from '@/lib/db';
export default function Complex() { return <div />; }
```

## Do NOT Touch

- Any existing test files
- Any source files — this task is test-only

## Verification

```bash
# Tests run and pass
npx vitest run tests/source-scanner.test.ts

# All test suites present
grep -c "describe(" tests/source-scanner.test.ts  # should be 7+
grep -c "it(" tests/source-scanner.test.ts         # should be 12+
```
