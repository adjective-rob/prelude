import { join, posix } from 'path';
import { readJSON, fileExists } from '../utils/fs.js';
import { CONTEXT_FILES } from '../constants.js';
import { resolveContextDir } from '../runtime/context.js';
import type { CodeMap, Decisions, Architecture, MapFile, MapModule } from '../schema/index.js';

/**
 * locate — turn a task phrase into the handful of files most likely
 * relevant. Keyword scoring over map.json, plus architecture roles and
 * decisions that mention files. No embeddings, no network.
 */

export interface LocateHit {
  file: string;
  module: string;
  purpose?: string;
  score: number;        // integer part from evidence, fractional part from rank
  rank?: number;
  importedBy?: number;
  exports?: string[];   // first 5
  reasons: string[];
}

export interface LocateOptions {
  limit?: number;         // default 8
  scope?: string;         // restrict to files under this directory
  includeTests?: boolean; // default: true only if the query mentions test/spec
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'for', 'on', 'at', 'is', 'are', 'be', 'do', 'does',
  'how', 'where', 'what', 'which', 'and', 'or', 'with', 'that', 'this', 'it', 'my', 'our',
  'your', 'i', 'we', 'you', 'code', 'file', 'files', 'function', 'functions', 'class', 'method',
]);

function singular(token: string): string {
  return token.length >= 5 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

/** Split camelCase / PascalCase / snake_case / paths into lowercase words, before stopword removal. */
function splitWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of splitWords(text)) {
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    const t = singular(word);
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Tokens for indexing: same normalisation as queries, no stopword removal. */
function indexTokens(text: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!text) return set;
  for (const w of splitWords(text)) set.add(singular(w));
  return set;
}

interface FileIndex {
  file: MapFile;
  module: MapModule;
  basename: string;               // lowercased, extension stripped
  basenameWords: Set<string>;     // `query-engine` → query, engine
  dirSegments: Set<string>;       // lowercased, singularised
  exports: Array<{ name: string; raw: string; parts: Set<string> }>;
  role?: string;
  roleTokens: Set<string>;
  moduleTokens: Set<string>;
  decisions: Array<{ title: string; tokens: Set<string> }>;
}

function normalizeScope(scope: string): string {
  return scope.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\//, '');
}

function mentionsFile(text: string, file: string): boolean {
  if (text.includes(file)) return true;
  const base = posix.basename(file);
  // Bare basename mentions ("merger.ts") count when bounded by non-word chars
  const re = new RegExp(`(^|[^\\w/.-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`);
  return re.test(text);
}

function buildIndex(
  map: CodeMap,
  decisions: Decisions | undefined,
  architecture: Architecture | undefined
): FileIndex[] {
  const roles = new Map<string, string>();
  for (const ep of architecture?.entryPoints ?? []) if (ep?.file && ep.purpose) roles.set(ep.file, ep.purpose);
  for (const kf of architecture?.keyFiles ?? []) if (kf?.file && kf.role && !roles.has(kf.file)) roles.set(kf.file, kf.role);

  const decisionTexts = (decisions?.decisions ?? []).map(d => {
    const text = [d.title, d.rationale, d.impact, ...(d.alternatives ?? []), ...(d.tags ?? [])].filter(Boolean).join('\n');
    return {
      title: d.title,
      text,
      tokens: new Set([...indexTokens(d.title), ...indexTokens(d.rationale), ...(d.tags ?? []).flatMap(t => [...indexTokens(t)])]),
    };
  });

  const index: FileIndex[] = [];
  for (const mod of map.modules) {
    const moduleTokens = new Set([...indexTokens(mod.purpose), ...indexTokens(mod.notes)]);
    for (const f of mod.files) {
      const parts = f.file.split('/');
      const base = parts[parts.length - 1].replace(/\.[^.]+$/, '').toLowerCase();
      const dirSegments = new Set<string>();
      for (const seg of parts.slice(0, -1)) {
        dirSegments.add(singular(seg.toLowerCase()));
        for (const w of splitWords(seg)) dirSegments.add(singular(w));
      }
      const role = f.role ?? roles.get(f.file);
      index.push({
        file: f,
        module: mod,
        basename: base,
        basenameWords: indexTokens(base),
        dirSegments,
        exports: (f.exports ?? []).map(name => ({ name, raw: name.toLowerCase(), parts: indexTokens(name) })),
        role,
        roleTokens: indexTokens(role),
        moduleTokens,
        decisions: decisionTexts
          .filter(d => mentionsFile(d.text, f.file))
          .map(d => ({ title: d.title, tokens: d.tokens })),
      });
    }
  }
  return index;
}

export function locateInMap(
  map: CodeMap,
  query: string,
  opts: LocateOptions = {},
  extra: { decisions?: Decisions; architecture?: Architecture } = {}
): LocateHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const limit = opts.limit ?? 8;
  const includeTests = opts.includeTests ?? tokens.some(t => t.startsWith('test') || t.startsWith('spec'));
  const scope = opts.scope ? normalizeScope(opts.scope) : undefined;

  const hits: LocateHit[] = [];
  for (const entry of buildIndex(map, extra.decisions, extra.architecture)) {
    const { file, module } = entry;
    if (file.isTest && !includeTests) continue;
    if (scope && !(file.file === scope || file.file.startsWith(scope + '/'))) continue;

    let points = 0;
    const reasons: string[] = [];
    const addReason = (r: string) => {
      if (!reasons.includes(r)) reasons.push(r);
    };
    let tokensHit = 0;

    for (const t of tokens) {
      let tokenPoints = 0;

      // Best export match for this token
      let bestExport: { name: string; points: number } | undefined;
      for (const ex of entry.exports) {
        let p = 0;
        if (t === ex.raw) p = 5;
        else if (ex.parts.has(t)) p = 3;
        else if (t.length >= 4 && ex.raw.includes(t)) p = 2;
        if (p > (bestExport?.points ?? 0)) bestExport = { name: ex.name, points: p };
        if (p === 5) break;
      }
      if (bestExport) {
        tokenPoints += bestExport.points;
        addReason(`export ${bestExport.name}`);
      }

      if (t === entry.basename) {
        tokenPoints += 4;
        addReason(`file ${entry.basename}`);
      } else if (entry.basenameWords.has(t)) {
        tokenPoints += 3;
        addReason(`file ${entry.basename}`);
      } else if (t.length >= 4 && entry.basename.includes(t)) {
        tokenPoints += 2;
        addReason(`file ${entry.basename}`);
      }

      if (entry.dirSegments.has(t)) {
        tokenPoints += 3;
        addReason(`path ${t}`);
      }

      if (entry.roleTokens.has(t)) {
        tokenPoints += 3;
        addReason(`role: ${entry.role}`);
      }

      if (entry.moduleTokens.has(t)) {
        tokenPoints += 2;
        addReason(`module: ${module.purpose ?? module.notes}`);
      }

      for (const d of entry.decisions) {
        if (d.tokens.has(t)) {
          tokenPoints += 2;
          addReason(`decision: ${d.title}`);
          break;
        }
      }

      if (tokenPoints > 0) tokensHit++;
      points += tokenPoints;
    }

    if (points === 0) continue;
    if (tokens.length > 1 && tokensHit === tokens.length) {
      points += 3;
      addReason('matches all terms');
    }

    const hit: LocateHit = {
      file: file.file,
      module: module.path,
      score: Math.round((points + (file.rank ?? 0)) * 100) / 100,
      reasons,
    };
    if (module.purpose) hit.purpose = module.purpose;
    if (file.rank) hit.rank = file.rank;
    if (file.importedBy) hit.importedBy = file.importedBy;
    if (file.exports?.length) hit.exports = file.exports.slice(0, 5);
    hits.push(hit);
  }

  hits.sort((a, b) =>
    b.score - a.score ||
    (b.importedBy ?? 0) - (a.importedBy ?? 0) ||
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
  );
  return hits.slice(0, limit);
}

async function readOptional<T>(path: string): Promise<T | undefined> {
  if (!(await fileExists(path))) return undefined;
  try {
    return await readJSON<T>(path);
  } catch {
    return undefined;
  }
}

/** Load map.json (required) plus decisions/architecture (optional). */
export async function loadLocateContext(rootDir: string): Promise<{
  map: CodeMap;
  decisions?: Decisions;
  architecture?: Architecture;
}> {
  const contextDir = resolveContextDir(rootDir);
  const map = await readOptional<CodeMap>(join(contextDir, CONTEXT_FILES.MAP));
  if (!map || !Array.isArray(map.modules)) {
    throw new Error('map.json not found. Run `prelude update` to build it.');
  }
  return {
    map,
    decisions: await readOptional<Decisions>(join(contextDir, CONTEXT_FILES.DECISIONS)),
    architecture: await readOptional<Architecture>(join(contextDir, CONTEXT_FILES.ARCHITECTURE)),
  };
}

export async function locate(rootDir: string, query: string, opts: LocateOptions = {}): Promise<LocateHit[]> {
  const { map, decisions, architecture } = await loadLocateContext(rootDir);
  return locateInMap(map, query, opts, { decisions, architecture });
}

/** Plain-text rendering shared by the CLI and MCP tool. */
export function formatLocateText(hits: LocateHit[], query: string, map?: CodeMap): string {
  if (hits.length === 0) {
    const hubs = (map?.hubs ?? []).slice(0, 5);
    let out = `No matches for "${query}".`;
    if (hubs.length > 0) {
      out += ' Start with the hubs:\n' + hubs.map(h => `  ${h.file} (imported by ${h.importedBy})`).join('\n');
    }
    return out + '\n';
  }
  return hits
    .map((h, i) => {
      const mod = h.purpose ? `${h.module} (${h.purpose})` : h.module;
      let block = `${i + 1}. ${h.file}  ·  ${mod}  ·  score ${Math.floor(h.score)}\n`;
      if (h.exports?.length) block += `   exports: ${h.exports.join(', ')}\n`;
      block += `   why: ${h.reasons.join(', ')}\n`;
      return block;
    })
    .join('');
}
