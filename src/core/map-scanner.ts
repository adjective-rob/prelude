import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, basename, posix } from 'path';
import type { Architecture, MapLang, MapFile, MapModule, MapHub, CodeMap } from '../schema/index.js';
import { SKIP_DIRS, SOURCE_EXTENSIONS } from './source-scanner.js';
import { inferDirectoryPurpose } from './vocab.js';

/**
 * Map scanner — builds the routing map behind map.json.
 *
 * Reads every source file (tests included), extracts exports, resolves
 * internal imports to repo-relative files, ranks files by in-degree from
 * non-test files, groups files into modules, and picks hub files.
 *
 * Regex heuristics, not AST parsing. Accuracy is "good enough to route":
 * a wrong pointer costs the agent one wasted read.
 *
 * Go imports resolve to package directories, not files. Those targets are
 * stored with a trailing slash (`internal/api/`). Directory targets never
 * increment a file's `importedBy`, but they do contribute to module
 * `dependsOn` / `dependedOnBy`.
 */

const SCHEMA_URL = 'https://adjective.us/prelude/schemas/v1';
const MAP_VERSION = '1.0.0';

const MAX_EXPORTS = 40;
const MAX_MODULE_FILES = 60;
const MAX_HUBS = 15;
const MODULE_DEPTH = 3;
const READ_BATCH = 32;

export type { MapLang, MapFile, MapModule, MapHub, CodeMap };

export interface BuildMapOptions {
  architecture?: Architecture;   // for role tagging and entry-point rank bonus
  maxFiles?: number;             // default 5000
  maxFileBytes?: number;         // default 512 * 1024
}

// --- Walk ---

const LANG_BY_EXT: Record<string, MapLang> = {
  '.ts': 'ts', '.tsx': 'ts',
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py',
  '.go': 'go',
  '.rs': 'rs',
};

async function walkSourceFiles(rootDir: string, maxFiles: number): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  let truncated = false;

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 8 || truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort so truncation and output never depend on readdir order
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (truncated) return;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') || entry.name.endsWith('.egg-info')) continue;
        await walk(join(dir, entry.name), relPath, depth + 1);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && LANG_BY_EXT[extname(entry.name)]) {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        files.push(relPath);
      }
    }
  }

  await walk(rootDir, '', 0);
  files.sort();
  return { files, truncated };
}

const TEST_DIR_MARKERS = ['/tests/', '/test/', '/__tests__/', '/spec/'];
const TEST_BASENAME_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /^test_.*\.py$/,
  /_test\.py$/,
  /^conftest\.py$/,
  /_test\.go$/,
];

export function isTestFile(file: string): boolean {
  const withSlash = '/' + file;
  if (TEST_DIR_MARKERS.some(m => withSlash.includes(m))) return true;
  const base = basename(file);
  return TEST_BASENAME_PATTERNS.some(re => re.test(base));
}

// --- Comment stripping ---

/**
 * Blank out comments while leaving strings intact (import specifiers live
 * in strings). Newlines are preserved so `^` anchors still work.
 * Single/double-quoted strings end at a newline, which bounds the damage
 * when a regex literal contains a stray quote.
 */
function stripCStyleComments(src: string, quotes: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (quotes.includes(c)) {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (src[i] === '\n' && quote !== '`') break;
        out += src[i];
        i++;
      }
      if (i < n && src[i] === quote) {
        out += quote;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Strip `#` comments and blank triple-quoted strings (docstrings). */
function stripPythonComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if ((c === '"' || c === "'") && src[i + 1] === c && src[i + 2] === c) {
      const triple = c + c + c;
      const end = src.indexOf(triple, i + 3);
      const stop = end === -1 ? n : end + 3;
      for (let k = i; k < stop; k++) if (src[k] === '\n') out += '\n';
      out += '""';
      i = stop;
      continue;
    }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      if (i < n && src[i] === c) {
        out += c;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function stripComments(content: string, lang: MapLang): string {
  switch (lang) {
    case 'ts':
    case 'js':
      return stripCStyleComments(content, `'"\``);
    case 'go':
      return stripCStyleComments(content, '"`');
    case 'rs':
      return stripCStyleComments(content, '"');
    case 'py':
      return stripPythonComments(content);
  }
}

// --- Exports ---

function collectOrdered(pairs: Array<[number, string]>): string[] {
  pairs.sort((a, b) => a[0] - b[0]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [, name] of pairs) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_EXPORTS) break;
  }
  return out;
}

function splitNameList(list: string): string[] {
  return list
    .split(',')
    .map(part => {
      let p = part.trim();
      if (p.startsWith('type ')) p = p.slice(5).trim();
      const asMatch = p.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) return asMatch[1];
      const m = p.match(/^[A-Za-z_$][\w$]*/);
      return m ? m[0] : '';
    })
    .filter(Boolean);
}

function extractJsExports(src: string): string[] {
  const pairs: Array<[number, string]> = [];
  const push = (re: RegExp, fn: (m: RegExpExecArray) => string[]) => {
    for (const m of src.matchAll(re)) {
      for (const name of fn(m as RegExpExecArray)) pairs.push([m.index ?? 0, name]);
    }
  };

  push(
    /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm,
    m => [m[1]]
  );
  push(/^\s*export\s+(?:type\s+)?\{([^}]*)\}/gm, m => splitNameList(m[1]));
  push(/^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm, m =>
    ['function', 'class', 'async', 'abstract'].includes(m[1]) ? [] : [m[1]]
  );
  push(/^\s*export\s+default\s+(?:async\s+)?(?:function\*?|class)\s*[({]/gm, () => ['default']);
  push(/module\.exports\s*=\s*\{([^}]*)\}/gm, m =>
    m[1]
      .split(',')
      .map(p => p.trim())
      .filter(p => p && !p.startsWith('...'))
      .map(p => (p.match(/^([A-Za-z_$][\w$]*)/) || [])[1] || '')
  );
  push(/\bexports\.([A-Za-z_$][\w$]*)\s*=/gm, m => [m[1]]);

  return collectOrdered(pairs);
}

function extractPyExports(src: string): string[] {
  const allMatch = src.match(/^__all__\s*=\s*[[(]([^\])]*)[\])]/m);
  if (allMatch) {
    const names = [...allMatch[1].matchAll(/['"]([A-Za-z_]\w*)['"]/g)].map(m => m[1]);
    return collectOrdered(names.map((n, i) => [i, n]));
  }
  const pairs: Array<[number, string]> = [];
  for (const m of src.matchAll(/^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm)) pairs.push([m.index ?? 0, m[1]]);
  for (const m of src.matchAll(/^class\s+([A-Za-z_]\w*)/gm)) pairs.push([m.index ?? 0, m[1]]);
  return collectOrdered(pairs.filter(([, name]) => !name.startsWith('_')));
}

function extractGoExports(src: string): string[] {
  const pairs: Array<[number, string]> = [];
  for (const m of src.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm)) pairs.push([m.index ?? 0, m[1]]);
  for (const m of src.matchAll(/^type\s+([A-Z]\w*)/gm)) pairs.push([m.index ?? 0, m[1]]);
  for (const m of src.matchAll(/^(?:var|const)\s+([A-Z]\w*)/gm)) pairs.push([m.index ?? 0, m[1]]);
  for (const block of src.matchAll(/^(?:var|const|type)\s*\(([\s\S]*?)^\)/gm)) {
    const base = (block.index ?? 0) + block[0].indexOf('(') + 1;
    for (const m of block[1].matchAll(/^\s+([A-Z]\w*)\s/gm)) pairs.push([base + (m.index ?? 0), m[1]]);
  }
  return collectOrdered(pairs);
}

function extractRsExports(src: string): string[] {
  const pairs: Array<[number, string]> = [];
  for (const m of src.matchAll(/^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static|mod)\s+([A-Za-z_]\w*)/gm)) {
    pairs.push([m.index ?? 0, m[1]]);
  }
  return collectOrdered(pairs);
}

function extractExports(src: string, lang: MapLang): string[] {
  switch (lang) {
    case 'ts':
    case 'js':
      return extractJsExports(src);
    case 'py':
      return extractPyExports(src);
    case 'go':
      return extractGoExports(src);
    case 'rs':
      return extractRsExports(src);
  }
}

// --- Resolution context ---

interface AliasRule {
  prefix: string;      // specifier prefix (wildcard stripped)
  exact: boolean;      // pattern had no `*`
  targets: string[];   // repo-relative target prefixes (wildcard stripped)
}

interface ResolveContext {
  rootDir: string;
  files: Set<string>;
  statCache: Map<string, boolean>;
  aliases: AliasRule[] | null;   // null = no tsconfig/jsconfig paths
  pyRoots: string[];             // repo-relative roots ('' = repo root)
  pyTopLevel: Set<string>;       // first segments that are internal packages/modules
  goModule?: string;
}

async function existsFile(ctx: ResolveContext, rel: string): Promise<boolean> {
  if (!rel || rel.startsWith('..') || posix.isAbsolute(rel)) return false;
  if (ctx.files.has(rel)) return true;
  const cached = ctx.statCache.get(rel);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    ok = (await stat(join(ctx.rootDir, rel))).isFile();
  } catch {
    ok = false;
  }
  ctx.statCache.set(rel, ok);
  return ok;
}

function stripJsonComments(text: string): string {
  return stripCStyleComments(text, '"').replace(/,(\s*[}\]])/g, '$1');
}

async function loadAliases(rootDir: string): Promise<AliasRule[] | null> {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let raw: string;
    try {
      raw = await readFile(join(rootDir, name), 'utf-8');
    } catch {
      continue;
    }
    try {
      const config = JSON.parse(stripJsonComments(raw));
      const opts = config?.compilerOptions ?? {};
      const paths = opts.paths as Record<string, string[]> | undefined;
      if (!paths || typeof paths !== 'object') return null;
      const baseUrl = typeof opts.baseUrl === 'string' ? opts.baseUrl : '.';
      const rules: AliasRule[] = [];
      for (const [pattern, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets)) continue;
        const exact = !pattern.includes('*');
        rules.push({
          prefix: pattern.replace(/\*.*$/, ''),
          exact,
          targets: targets.map(t => posix.normalize(posix.join(baseUrl, String(t).replace(/\*.*$/, '')))),
        });
      }
      // Longest prefix first so `@/lib/*` beats `@/*`
      rules.sort((a, b) => b.prefix.length - a.prefix.length);
      return rules;
    } catch {
      return null;
    }
  }
  return null;
}

async function loadGoModule(rootDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(rootDir, 'go.mod'), 'utf-8');
    return raw.match(/^module\s+(\S+)/m)?.[1];
  } catch {
    return undefined;
  }
}

function computePyRoots(files: string[]): { roots: string[]; topLevel: Set<string> } {
  const fileSet = new Set(files);
  const roots = new Set<string>(['', 'src']);
  // Top-level dirs that are packages, or that contain packages (backend/app/__init__.py)
  for (const f of files) {
    const parts = f.split('/');
    if (parts.length === 2 && parts[1] === '__init__.py') roots.add(parts[0]);
    if (parts.length === 3 && parts[2] === '__init__.py') roots.add(parts[0]);
  }
  const rootList = [...roots].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  const topLevel = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.py')) continue;
    for (const root of rootList) {
      const prefix = root ? root + '/' : '';
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length).split('/');
      if (rest.length === 1) topLevel.add(rest[0].replace(/\.py$/, ''));
      else if (fileSet.has(prefix + rest[0] + '/__init__.py')) topLevel.add(rest[0]);
    }
  }
  return { roots: rootList, topLevel };
}

// --- Import extraction + resolution ---

interface ResolveResult {
  targets: string[];
  unresolved: number;
}

async function resolveJsPath(ctx: ResolveContext, base: string): Promise<string | undefined> {
  const hasKnownExt = /\.(?:[cm]?[jt]sx?|json)$/.test(base);
  const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
  const candidates = [
    `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.jsx`, `${stem}.mts`, `${stem}.cts`,
    `${stem}/index.ts`, `${stem}/index.tsx`, `${stem}/index.js`,
  ];
  if (hasKnownExt) candidates.push(base);
  for (const c of candidates) {
    if (await existsFile(ctx, c)) return c;
  }
  return undefined;
}

async function resolveJsImports(ctx: ResolveContext, file: string, src: string): Promise<ResolveResult> {
  const specs = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
    /\bimport\s*['"]([^'"\n]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) specs.add(m[1]);
  }

  const targets: string[] = [];
  let unresolved = 0;
  const dir = posix.dirname(file);

  for (const spec of specs) {
    let internal = false;
    let resolved: string | undefined;

    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
      internal = true;
      resolved = await resolveJsPath(ctx, posix.normalize(posix.join(dir, spec)));
    } else if (ctx.aliases) {
      for (const rule of ctx.aliases) {
        const matches = rule.exact ? spec === rule.prefix : spec.startsWith(rule.prefix);
        if (!matches) continue;
        internal = true;
        const rest = rule.exact ? '' : spec.slice(rule.prefix.length);
        for (const target of rule.targets) {
          resolved = await resolveJsPath(ctx, posix.normalize(target + rest));
          if (resolved) break;
        }
        if (resolved) break;
      }
    } else if (spec.startsWith('@/') || spec.startsWith('~/')) {
      internal = true;
      const rest = spec.slice(2);
      resolved = (await resolveJsPath(ctx, posix.normalize(`src/${rest}`))) ?? (await resolveJsPath(ctx, posix.normalize(rest)));
    }

    if (resolved) targets.push(resolved);
    else if (internal) unresolved++;
  }

  return { targets, unresolved };
}

async function resolvePyModule(ctx: ResolveContext, roots: string[], modulePath: string): Promise<string | undefined> {
  if (!modulePath) return undefined;
  for (const root of roots) {
    const prefix = root ? root + '/' : '';
    for (const c of [`${prefix}${modulePath}.py`, `${prefix}${modulePath}/__init__.py`]) {
      if (await existsFile(ctx, c)) return c;
    }
  }
  return undefined;
}

async function resolvePyImports(ctx: ResolveContext, file: string, src: string): Promise<ResolveResult> {
  const statements: Array<{ module: string; names: string[] }> = [];

  for (const m of src.matchAll(/^\s*import\s+([\w., ]+)/gm)) {
    for (const part of m[1].split(',')) {
      const mod = part.trim().split(/\s+as\s+/)[0].trim();
      if (mod) statements.push({ module: mod, names: [] });
    }
  }
  for (const m of src.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+(\([^)]*\)|[^\n]+)/gm)) {
    const names = m[2]
      .replace(/[()]/g, ' ')
      .split(',')
      .map(n => n.trim().split(/\s+as\s+/)[0].trim())
      .filter(n => /^[A-Za-z_]\w*$/.test(n));
    statements.push({ module: m[1], names });
  }

  const targets: string[] = [];
  let unresolved = 0;

  for (const { module, names } of statements) {
    const dots = module.match(/^\.*/)?.[0].length ?? 0;
    const rest = module.slice(dots);
    const restPath = rest ? rest.split('.').join('/') : '';

    let roots: string[];
    let internal: boolean;
    if (dots > 0) {
      let base = posix.dirname(file);
      for (let k = 1; k < dots; k++) base = posix.dirname(base);
      roots = [base === '.' ? '' : base];
      internal = true;
    } else {
      roots = ctx.pyRoots;
      internal = ctx.pyTopLevel.has(rest.split('.')[0]);
      if (!internal) continue; // stdlib / third-party
    }

    const found: string[] = [];
    // `from pkg import submodule` — names may themselves be modules
    for (const name of names) {
      const sub = restPath ? `${restPath}/${name}` : name;
      const hit = await resolvePyModule(ctx, roots, sub);
      if (hit) found.push(hit);
    }
    if (found.length === 0 && restPath) {
      const hit = await resolvePyModule(ctx, roots, restPath);
      if (hit) found.push(hit);
      else {
        // `import pkg.module.attr` — drop the last segment
        const parent = restPath.split('/').slice(0, -1).join('/');
        const parentHit = await resolvePyModule(ctx, roots, parent);
        if (parentHit) found.push(parentHit);
      }
    }

    if (found.length > 0) targets.push(...found);
    else if (internal) unresolved++;
  }

  return { targets, unresolved };
}

function resolveGoImports(ctx: ResolveContext, src: string, dirs: Set<string>): ResolveResult {
  if (!ctx.goModule) return { targets: [], unresolved: 0 };
  const specs: string[] = [];
  for (const m of src.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) specs.push(m[1]);
  for (const block of src.matchAll(/^import\s*\(([\s\S]*?)^\)/gm)) {
    for (const m of block[1].matchAll(/^\s*(?:[\w.]+\s+)?"([^"]+)"/gm)) specs.push(m[1]);
  }

  const targets: string[] = [];
  let unresolved = 0;
  const prefix = ctx.goModule + '/';
  for (const spec of specs) {
    if (!spec.startsWith(prefix)) continue;
    const rest = spec.slice(prefix.length).replace(/\/+$/, '');
    if (dirs.has(rest)) targets.push(rest + '/');
    else unresolved++;
  }
  return { targets, unresolved };
}

/** Crate source root for a Rust file: everything up to and including the last `src` segment. */
function rustCrateRoot(file: string): string {
  const parts = file.split('/');
  const idx = parts.lastIndexOf('src');
  return idx >= 0 ? parts.slice(0, idx + 1).join('/') : 'src';
}

/** Module path segments of a Rust file relative to its crate root. */
function rustModuleSegments(file: string, crateRoot: string): string[] {
  const rel = file.startsWith(crateRoot + '/') ? file.slice(crateRoot.length + 1) : file;
  const parts = rel.replace(/\.rs$/, '').split('/');
  const last = parts[parts.length - 1];
  if (parts.length === 1 && (last === 'main' || last === 'lib')) return [];
  if (last === 'mod') parts.pop();
  return parts;
}

async function resolveRustPath(ctx: ResolveContext, crateRoot: string, segments: string[]): Promise<string | undefined> {
  for (let len = segments.length; len >= 1; len--) {
    const p = segments.slice(0, len).join('/');
    for (const c of [`${crateRoot}/${p}.rs`, `${crateRoot}/${p}/mod.rs`]) {
      if (await existsFile(ctx, c)) return c;
    }
  }
  return undefined;
}

async function resolveRustImports(ctx: ResolveContext, file: string, src: string): Promise<ResolveResult> {
  const targets: string[] = [];
  let unresolved = 0;
  const dir = posix.dirname(file);
  const base = basename(file, '.rs');
  const crateRoot = rustCrateRoot(file);
  const ownSegments = rustModuleSegments(file, crateRoot);
  const isModRoot = base === 'mod' || ((base === 'main' || base === 'lib') && dir === crateRoot);

  for (const m of src.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) {
    const name = m[1];
    const candidates = isModRoot
      ? [`${dir}/${name}.rs`, `${dir}/${name}/mod.rs`]
      : [`${dir}/${base}/${name}.rs`, `${dir}/${base}/${name}/mod.rs`, `${dir}/${name}.rs`, `${dir}/${name}/mod.rs`];
    let hit: string | undefined;
    for (const c of candidates) {
      if (await existsFile(ctx, posix.normalize(c))) {
        hit = posix.normalize(c);
        break;
      }
    }
    if (hit) targets.push(hit);
    else unresolved++;
  }

  for (const m of src.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+(crate|super|self)::([\w:]+)/gm)) {
    const pathSegs = m[2].split('::').filter(Boolean);
    let segments: string[];
    if (m[1] === 'crate') segments = pathSegs;
    else if (m[1] === 'self') segments = [...ownSegments, ...pathSegs];
    else segments = [...ownSegments.slice(0, -1), ...pathSegs];

    const hit = await resolveRustPath(ctx, crateRoot, segments);
    if (hit && hit !== file) targets.push(hit);
    else if (!hit) unresolved++;
  }

  return { targets, unresolved };
}

// --- Module helpers ---

function moduleOf(pathOrDir: string): string {
  const dir = pathOrDir.endsWith('/') ? pathOrDir.slice(0, -1) : posix.dirname(pathOrDir);
  if (!dir || dir === '.') return '.';
  return dir.split('/').slice(0, MODULE_DEPTH).join('/');
}

const EXPORT_PURPOSE_RULES: Array<[RegExp, string]> = [
  [/^register\w+Command$/, 'CLI command registrations'],
  [/Schema$/, 'Schema definitions'],
  [/^use[A-Z]/, 'React hooks'],
  [/(Provider|Context)$/, 'React context providers'],
  [/(Handler|Controller)$/, 'Request handlers'],
  [/(Service|Repository|Store)$/, 'Services'],
  [/^(get|list|find|create|update|delete|upsert)[A-Z]/, 'Data access functions'],
  [/^(test_|Test)/, 'Tests'],
];

function purposeFromExports(files: MapFile[]): string | undefined {
  const exports = files.filter(f => !f.isTest).flatMap(f => f.exports ?? []);
  if (exports.length < 3) return undefined;
  for (const [re, purpose] of EXPORT_PURPOSE_RULES) {
    const hits = exports.filter(e => re.test(e)).length;
    if (hits / exports.length >= 0.6) return purpose;
  }
  return undefined;
}

// --- Main entry ---

interface ParsedFile {
  file: string;
  lang: MapLang;
  lines: number;
  isTest: boolean;
  exports: string[];
  stripped: string;
}

async function readSource(rootDir: string, file: string, maxFileBytes: number): Promise<ParsedFile | null> {
  try {
    const full = join(rootDir, file);
    const info = await stat(full);
    if (info.size > maxFileBytes) return null;
    const buf = await readFile(full);
    if (buf.subarray(0, 512).includes(0)) return null;
    const content = buf.toString('utf-8');
    const lang = LANG_BY_EXT[extname(file)];
    let lines = 0;
    for (let k = 0; k < content.length; k++) if (content.charCodeAt(k) === 10) lines++;
    if (content.length > 0 && !content.endsWith('\n')) lines++;
    const stripped = stripComments(content, lang);
    return {
      file,
      lang,
      lines,
      isTest: isTestFile(file),
      exports: extractExports(stripped, lang),
      stripped,
    };
  } catch {
    return null;
  }
}

export async function buildMap(rootDir: string, opts: BuildMapOptions = {}): Promise<CodeMap> {
  const maxFiles = opts.maxFiles ?? 5000;
  const maxFileBytes = opts.maxFileBytes ?? 512 * 1024;

  const { files: walked, truncated } = await walkSourceFiles(rootDir, maxFiles);

  // Read in bounded batches
  const parsed: ParsedFile[] = [];
  for (let i = 0; i < walked.length; i += READ_BATCH) {
    const batch = await Promise.all(walked.slice(i, i + READ_BATCH).map(f => readSource(rootDir, f, maxFileBytes)));
    for (const p of batch) if (p) parsed.push(p);
  }

  const { roots: pyRoots, topLevel: pyTopLevel } = computePyRoots(walked);
  const ctx: ResolveContext = {
    rootDir,
    files: new Set(walked),
    statCache: new Map(),
    aliases: await loadAliases(rootDir),
    pyRoots,
    pyTopLevel,
    goModule: parsed.some(p => p.lang === 'go') ? await loadGoModule(rootDir) : undefined,
  };
  const goDirs = new Set(parsed.filter(p => p.lang === 'go').map(p => posix.dirname(p.file)));

  // Resolve imports
  const importsByFile = new Map<string, string[]>();
  let unresolvedImports = 0;
  let edges = 0;
  for (const p of parsed) {
    let result: ResolveResult = { targets: [], unresolved: 0 };
    try {
      switch (p.lang) {
        case 'ts':
        case 'js':
          result = await resolveJsImports(ctx, p.file, p.stripped);
          break;
        case 'py':
          result = await resolvePyImports(ctx, p.file, p.stripped);
          break;
        case 'go':
          result = resolveGoImports(ctx, p.stripped, goDirs);
          break;
        case 'rs':
          result = await resolveRustImports(ctx, p.file, p.stripped);
          break;
      }
    } catch {
      // best-effort: a failed resolution never fails the map
    }
    const targets = [...new Set(result.targets)].filter(t => t !== p.file).sort();
    importsByFile.set(p.file, targets);
    unresolvedImports += result.unresolved;
    edges += targets.length;
  }

  // In-degree from non-test files, file targets only
  const importedBy = new Map<string, number>();
  for (const p of parsed) {
    if (p.isTest) continue;
    for (const t of importsByFile.get(p.file) ?? []) {
      if (t.endsWith('/')) continue;
      importedBy.set(t, (importedBy.get(t) ?? 0) + 1);
    }
  }
  const maxIn = Math.max(0, ...importedBy.values());

  const roles = new Map<string, string>();
  for (const ep of opts.architecture?.entryPoints ?? []) if (ep?.file) roles.set(ep.file, ep.purpose);
  for (const kf of opts.architecture?.keyFiles ?? []) if (kf?.file && !roles.has(kf.file)) roles.set(kf.file, kf.role);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const mapFiles: MapFile[] = parsed.map(p => {
    const inDeg = importedBy.get(p.file) ?? 0;
    let rank = maxIn > 0 ? inDeg / maxIn : 0;
    const role = roles.get(p.file);
    if (role !== undefined) rank = Math.max(rank, 0.5);
    rank = round2(rank);

    const mf: MapFile = { file: p.file, lang: p.lang, lines: p.lines };
    if (p.exports.length > 0) mf.exports = p.exports;
    const imports = importsByFile.get(p.file) ?? [];
    if (imports.length > 0) mf.imports = imports;
    if (inDeg > 0) mf.importedBy = inDeg;
    if (rank > 0) mf.rank = rank;
    if (role) mf.role = role;
    if (p.isTest) mf.isTest = true;
    return mf;
  });

  // Group into modules
  const groups = new Map<string, MapFile[]>();
  for (const mf of mapFiles) {
    const mod = moduleOf(mf.file);
    const list = groups.get(mod);
    if (list) list.push(mf);
    else groups.set(mod, [mf]);
  }

  const dependsOn = new Map<string, Set<string>>();
  const dependedOnBy = new Map<string, Set<string>>();
  const tests = new Map<string, Set<string>>();
  const addTo = (m: Map<string, Set<string>>, key: string, value: string) => {
    const s = m.get(key);
    if (s) s.add(value);
    else m.set(key, new Set([value]));
  };
  const testFiles = new Set(mapFiles.filter(f => f.isTest).map(f => f.file));

  for (const mf of mapFiles) {
    const from = moduleOf(mf.file);
    for (const t of mf.imports ?? []) {
      const to = moduleOf(t);
      if (!groups.has(to)) continue;
      if (mf.isTest) {
        if (!testFiles.has(t)) addTo(tests, to, mf.file);
      } else if (to !== from) {
        addTo(dependsOn, from, to);
        addTo(dependedOnBy, to, from);
      }
    }
    // Go tests live in the package they test
    if (mf.isTest && mf.lang === 'go') addTo(tests, from, mf.file);
  }

  const sortedSet = (s?: Set<string>) => (s && s.size > 0 ? [...s].sort() : undefined);

  const modules: MapModule[] = [...groups.keys()].sort().map(path => {
    const all = groups.get(path)!;
    let files = [...all].sort((a, b) => (a.file < b.file ? -1 : 1));
    let isTruncated = false;
    if (files.length > MAX_MODULE_FILES) {
      files = [...files]
        .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || (a.file < b.file ? -1 : 1))
        .slice(0, MAX_MODULE_FILES)
        .sort((a, b) => (a.file < b.file ? -1 : 1));
      isTruncated = true;
    }

    const mod: MapModule = { path, fileCount: all.length, files };
    const purpose = (path === '.' ? undefined : inferDirectoryPurpose(path)) ?? purposeFromExports(all);
    if (purpose) mod.purpose = purpose;
    if (isTruncated) mod.truncated = true;
    const deps = sortedSet(dependsOn.get(path));
    if (deps) mod.dependsOn = deps;
    const depBy = sortedSet(dependedOnBy.get(path));
    if (depBy) mod.dependedOnBy = depBy;
    const t = sortedSet(tests.get(path));
    if (t) mod.tests = t;

    // Key order: path, purpose, notes, fileCount, truncated, files, deps, tests
    return {
      path: mod.path,
      ...(mod.purpose ? { purpose: mod.purpose } : {}),
      fileCount: mod.fileCount,
      ...(mod.truncated ? { truncated: true } : {}),
      files: mod.files,
      ...(mod.dependsOn ? { dependsOn: mod.dependsOn } : {}),
      ...(mod.dependedOnBy ? { dependedOnBy: mod.dependedOnBy } : {}),
      ...(mod.tests ? { tests: mod.tests } : {}),
    };
  });

  const hubs: MapHub[] = mapFiles
    .filter(f => (f.importedBy ?? 0) > 0)
    .sort((a, b) => (b.importedBy ?? 0) - (a.importedBy ?? 0) || (a.file < b.file ? -1 : 1))
    .slice(0, MAX_HUBS)
    .map(f => {
      const hub: MapHub = { file: f.file, importedBy: f.importedBy ?? 0, rank: f.rank ?? 0 };
      if (f.exports?.length) hub.exports = f.exports.slice(0, 5);
      return hub;
    });

  const map: CodeMap = {
    $schema: `${SCHEMA_URL}/map.schema.json`,
    version: MAP_VERSION,
    stats: {
      files: mapFiles.length,
      modules: modules.length,
      edges,
      unresolvedImports,
      ...(truncated ? { truncated: true } : {}),
    },
    modules,
  };
  if (hubs.length > 0) map.hubs = hubs;
  return map;
}
