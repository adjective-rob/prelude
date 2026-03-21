import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, basename, dirname, extname } from 'path';
import { getDirectoryTree } from '../utils/fs.js';
import { IGNORE_PATTERNS } from '../constants.js';

// --- Exported interfaces ---

export interface SourceScanResult {
  reactPatterns: {
    serverComponents: string[];
    clientComponents: string[];
    serverActions: string[];
    hooks: HookInfo[];
    providers: ProviderInfo[];
    layouts: string[];
  };
  routes: RouteInfo[];
  middleware: MiddlewareInfo[];
  apiEndpoints: APIEndpointInfo[];
  keyFiles: KeyFileInfo[];
  importPatterns: {
    internalAliases: string[];
    heavyImporters: string[];
  };
}

export interface HookInfo {
  file: string;
  hooks: string[];
}

export interface ProviderInfo {
  file: string;
  name: string;
  contextName?: string;
}

export interface RouteInfo {
  file: string;
  path: string;
  methods?: string[];
  isDynamic: boolean;
}

export interface MiddlewareInfo {
  file: string;
  type: string;
  guards?: string[];
}

export interface APIEndpointInfo {
  file: string;
  path: string;
  methods: string[];
}

export interface KeyFileInfo {
  file: string;
  role: string;
}

// --- Constants ---

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const MAX_READ_LINES = 100;
const MAX_READ_BYTES = 4096;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', '.context', 'coverage', '.turbo']);
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

// --- Helpers ---

function matchesIgnorePattern(filePath: string): boolean {
  for (const pattern of IGNORE_PATTERNS) {
    // Convert glob pattern to a simple check
    const stripped = pattern.replace(/\*\*/g, '').replace(/\*/g, '');
    if (stripped && filePath.includes(stripped.replace(/\//g, '/'))) {
      return true;
    }
  }
  return false;
}

async function collectSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (SOURCE_EXTENSIONS.has(ext)) {
          const rel = relative(rootDir, fullPath);
          if (!matchesIgnorePattern(rel)) {
            files.push(rel);
          }
        }
      }
    }
  }

  await walk(rootDir, 0);
  return files;
}

async function readFileHead(rootDir: string, file: string): Promise<string | null> {
  try {
    const fullPath = join(rootDir, file);
    const buf = Buffer.alloc(MAX_READ_BYTES);
    const { createReadStream } = await import('fs');

    return await new Promise<string | null>((resolve) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      const stream = createReadStream(fullPath, { end: MAX_READ_BYTES - 1 });
      stream.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        chunks.push(buf);
        totalBytes += buf.length;
      });
      stream.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf-8');
        // Check for binary content (null bytes in first 512 bytes)
        if (content.slice(0, 512).includes('\0')) {
          resolve(null);
          return;
        }
        // Limit to first MAX_READ_LINES lines
        const lines = content.split('\n');
        resolve(lines.slice(0, MAX_READ_LINES).join('\n'));
      });
      stream.on('error', () => resolve(null));
    });
  } catch {
    return null;
  }
}

function inferRoutePath(file: string): string {
  // app/dashboard/settings/page.tsx → /dashboard/settings
  // app/api/users/route.ts → /api/users
  // pages/api/hello.ts → /api/hello
  let routePath = file
    .replace(/^.*?(?:src\/)?app\//, '/')
    .replace(/^.*?(?:src\/)?pages\//, '/')
    .replace(/\/(page|route)\.(tsx?|jsx?)$/, '')
    .replace(/\.(tsx?|jsx?)$/, '')
    .replace(/\/index$/, '/');

  // Normalize double slashes
  routePath = routePath.replace(/\/+/g, '/');

  // Convert [param] to :param for readability
  routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1');

  return routePath || '/';
}

// --- Scanner functions ---

function scanReactPatterns(file: string, content: string, result: SourceScanResult): void {
  const firstNonComment = content.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, '').trimStart();

  // "use client" / "use server" directives at file top
  if (/^["']use client["']/.test(firstNonComment)) {
    result.reactPatterns.clientComponents.push(file);
  }
  if (/^["']use server["']/.test(firstNonComment)) {
    result.reactPatterns.serverComponents.push(file);
  }

  // "use server" inside function body (not at top) → server actions
  if (!/^["']use server["']/.test(firstNonComment)) {
    if (/["']use server["']/.test(content)) {
      result.reactPatterns.serverActions.push(file);
    }
  }

  // Custom hooks: exported functions matching use[A-Z]
  const hookNames: string[] = [];
  const hookPatterns = [
    /export\s+(?:default\s+)?function\s+(use[A-Z]\w+)/g,
    /export\s+const\s+(use[A-Z]\w+)/g,
  ];
  for (const pattern of hookPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      hookNames.push(match[1]);
    }
  }
  if (hookNames.length > 0) {
    result.reactPatterns.hooks.push({ file, hooks: hookNames });
  }

  // Context providers
  const hasCreateContext = /createContext[<(]/.test(content);
  if (hasCreateContext) {
    const providerMatch = content.match(/export\s+(?:const|function|default\s+function)\s+(\w*(?:Provider|Context)\w*)/);
    const contextMatch = content.match(/(?:const|let)\s+(\w+)\s*=\s*createContext/);
    if (providerMatch || contextMatch) {
      result.reactPatterns.providers.push({
        file,
        name: providerMatch?.[1] || contextMatch?.[1] || 'Unknown',
        contextName: contextMatch?.[1],
      });
    }
  }

  // Layouts (Next.js App Router)
  if (/(?:^|\/)(?:src\/)?app\//.test(file) && /layout\.(tsx?|jsx?)$/.test(file)) {
    result.reactPatterns.layouts.push(file);
  }
}

function scanRoutes(file: string, content: string, result: SourceScanResult): void {
  // Next.js App Router pages
  if (/(?:^|\/)(?:src\/)?app\/.*\/page\.(tsx?|jsx?)$/.test(file) || /(?:^|\/)(?:src\/)?app\/page\.(tsx?|jsx?)$/.test(file)) {
    result.routes.push({
      file,
      path: inferRoutePath(file),
      isDynamic: file.includes('['),
    });
  }

  // Next.js App Router route handlers
  if (/(?:^|\/)(?:src\/)?app\/.*\/route\.(tsx?|jsx?)$/.test(file) || /(?:^|\/)(?:src\/)?app\/route\.(tsx?|jsx?)$/.test(file)) {
    const methods: string[] = [];
    for (const method of HTTP_METHODS) {
      const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
      if (re.test(content)) {
        methods.push(method);
      }
    }
    const path = inferRoutePath(file);
    result.apiEndpoints.push({ file, path, methods });
  }

  // Pages Router API routes
  if (/(?:^|\/)(?:src\/)?pages\/api\//.test(file)) {
    result.apiEndpoints.push({
      file,
      path: inferRoutePath(file),
      methods: ['handler'],
    });
  }

  // Express-style routes
  const expressRoutePattern = /(?:router|app)\.(get|post|put|patch|delete)\s*\(/gi;
  const expressMethods: string[] = [];
  let match;
  while ((match = expressRoutePattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    if (!expressMethods.includes(method)) {
      expressMethods.push(method);
    }
  }
  if (expressMethods.length > 0) {
    result.routes.push({
      file,
      path: file,
      methods: expressMethods,
      isDynamic: false,
    });
  }
}

function scanMiddleware(file: string, content: string, result: SourceScanResult): void {
  const fileName = basename(file);
  const dirName = dirname(file);

  // Next.js middleware at root or src/
  if ((fileName === 'middleware.ts' || fileName === 'middleware.js') &&
      (dirName === '.' || dirName === 'src')) {
    const guards: string[] = [];
    const matcherMatch = content.match(/matcher\s*:\s*\[(.*?)\]/s);
    if (matcherMatch) {
      const matcherContent = matcherMatch[1];
      const pathMatches = matcherContent.match(/['"]([^'"]+)['"]/g);
      if (pathMatches) {
        guards.push(...pathMatches.map(m => m.replace(/['"]/g, '')));
      }
    }
    result.middleware.push({
      file,
      type: 'Next.js middleware',
      ...(guards.length > 0 ? { guards } : {}),
    });
    return;
  }

  // Files in a middleware/ directory
  if (/(?:^|\/)middleware\//.test(file)) {
    result.middleware.push({
      file,
      type: 'custom',
    });
  }
}

function scanKeyFiles(file: string, content: string, result: SourceScanResult): void {
  const fileName = basename(file);
  const fileLower = file.toLowerCase();

  // Database connections
  if (/drizzle\(/.test(content) || /new PrismaClient/.test(content) || /createClient/.test(content)) {
    if (/(?:db|database|drizzle|prisma|supabase)/i.test(fileLower)) {
      result.keyFiles.push({ file, role: 'database connection' });
      return;
    }
  }
  if (/^(src\/)?(lib\/)?db\.\w+$/.test(file) || /^db\/index\.\w+$/.test(file)) {
    result.keyFiles.push({ file, role: 'database connection' });
    return;
  }

  // Auth config
  if (/(?:next-auth|@clerk|lucia|@supabase\/auth-helpers|@auth\/)/.test(content)) {
    result.keyFiles.push({ file, role: 'auth config' });
    return;
  }
  if (/^(src\/)?(lib\/)?auth\.\w+$/.test(file)) {
    result.keyFiles.push({ file, role: 'auth config' });
    return;
  }

  // Framework config
  if (/^(next|vite|nuxt|svelte)\.config\.\w+$/.test(fileName)) {
    result.keyFiles.push({ file, role: 'framework config' });
    return;
  }

  // Env config
  if (/^env\.\w+$/.test(fileName)) {
    result.keyFiles.push({ file, role: 'env config' });
    return;
  }
  const envCount = (content.match(/process\.env\./g) || []).length;
  if (envCount >= 5) {
    result.keyFiles.push({ file, role: 'env config' });
  }
}

function scanImportPatterns(file: string, content: string, result: SourceScanResult): void {
  // Internal aliases
  const aliasPattern = /from\s+['"](@\/|~\/|#)/g;
  let match;
  while ((match = aliasPattern.exec(content)) !== null) {
    const alias = match[1];
    if (!result.importPatterns.internalAliases.includes(alias)) {
      result.importPatterns.internalAliases.push(alias);
    }
  }

  // Heavy importers (10+ import lines)
  const importLines = content.split('\n').filter(line => /^import\s/.test(line.trimStart()));
  if (importLines.length >= 10) {
    result.importPatterns.heavyImporters.push(file);
  }
}

// --- Main export ---

export async function scanSources(rootDir: string): Promise<SourceScanResult> {
  const result: SourceScanResult = {
    reactPatterns: {
      serverComponents: [],
      clientComponents: [],
      serverActions: [],
      hooks: [],
      providers: [],
      layouts: [],
    },
    routes: [],
    middleware: [],
    apiEndpoints: [],
    keyFiles: [],
    importPatterns: {
      internalAliases: [],
      heavyImporters: [],
    },
  };

  const files = await collectSourceFiles(rootDir);

  for (const file of files) {
    const content = await readFileHead(rootDir, file);
    if (content === null) continue;

    try {
      scanReactPatterns(file, content, result);
      scanRoutes(file, content, result);
      scanMiddleware(file, content, result);
      scanKeyFiles(file, content, result);
      scanImportPatterns(file, content, result);
    } catch {
      // Skip files that cause errors in any scanner
      continue;
    }
  }

  return result;
}
