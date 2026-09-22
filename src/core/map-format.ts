import type { CodeMap, MapFile, MapModule } from '../schema/index.js';

/**
 * Filters and formatters for map.json, shared by query, compact, and export.
 */

function normalizeScope(scope: string): string {
  return scope.replace(/\/+$/, '').replace(/^\.\//, '');
}

function byRankThenPath(a: MapFile, b: MapFile): number {
  return (b.rank ?? 0) - (a.rank ?? 0) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
}

/** Files of a module ordered by importance. */
export function topFiles(mod: MapModule, n: number, opts: { includeTests?: boolean } = {}): MapFile[] {
  const pool = opts.includeTests ? mod.files : mod.files.filter(f => !f.isTest);
  return [...(pool.length > 0 ? pool : mod.files)].sort(byRankThenPath).slice(0, n);
}

/** A file path shown relative to its module. */
export function relativeToModule(file: string, modulePath: string): string {
  if (modulePath === '.' || !modulePath) return file;
  return file.startsWith(modulePath + '/') ? file.slice(modulePath.length + 1) : file;
}

function exportsSummary(exports: string[] | undefined, n: number): string {
  if (!exports || exports.length === 0) return '';
  const shown = exports.slice(0, n).join(', ');
  return exports.length > n ? `${shown}, +${exports.length - n}` : shown;
}

/**
 * Keep modules whose path/purpose/notes mention the topic, or that contain a
 * file whose path, role, or exports mention it. Returns undefined when
 * nothing matched.
 */
export function filterMapByTopic(map: CodeMap, topic: string): CodeMap | undefined {
  const t = topic.toLowerCase();
  const has = (s?: string) => Boolean(s && s.toLowerCase().includes(t));
  const fileMatches = (f: MapFile) => has(f.file) || has(f.role) || (f.exports ?? []).some(e => has(e));

  const matchedFiles = new Set<string>();
  const modules: MapModule[] = [];
  for (const mod of map.modules) {
    const moduleMatched = has(mod.path) || has(mod.purpose) || has(mod.notes);
    const files = mod.files.filter(fileMatches);
    files.forEach(f => matchedFiles.add(f.file));
    if (!moduleMatched && files.length === 0) continue;
    const kept = files.length > 0 ? files : topFiles(mod, 5, { includeTests: true }).sort((a, b) => (a.file < b.file ? -1 : 1));
    modules.push({ ...mod, fileCount: kept.length, truncated: undefined, files: kept });
  }
  if (modules.length === 0) return undefined;

  const hubs = (map.hubs ?? []).filter(h => matchedFiles.has(h.file));
  return {
    ...map,
    modules: modules.map(stripUndefined),
    ...(hubs.length > 0 ? { hubs } : { hubs: undefined }),
  };
}

/** Keep modules at or around a directory scope, and hubs under it. */
export function filterMapByScope(map: CodeMap, scope: string): CodeMap {
  const s = normalizeScope(scope);
  const modules = map.modules.filter(m => {
    const p = normalizeScope(m.path);
    return p.startsWith(s) || s.startsWith(p === '.' ? '\0' : p);
  });
  const hubs = (map.hubs ?? []).filter(h => h.file.startsWith(s + '/') || h.file === s);
  return { ...map, modules, hubs: hubs.length > 0 ? hubs : undefined };
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** Markdown body for the code map (no heading). */
export function formatMapBody(map: CodeMap): string {
  let md = '';
  const hubs = (map.hubs ?? []).slice(0, 8);
  if (hubs.length > 0) {
    md += '**Read first:**\n';
    for (const h of hubs) {
      const ex = exportsSummary(h.exports, 3);
      md += `- \`${h.file}\` — imported by ${h.importedBy}${ex ? ` · ${ex}` : ''}\n`;
    }
    md += '\n';
  }

  for (const mod of map.modules) {
    md += `### \`${mod.path}\`${mod.purpose ? ` — ${mod.purpose}` : ''}\n`;
    if (mod.notes) md += `_${mod.notes}_\n`;
    const deps: string[] = [];
    if (mod.dependsOn?.length) deps.push(`Depends on: ${mod.dependsOn.join(', ')}`);
    if (mod.dependedOnBy?.length) deps.push(`Used by: ${mod.dependedOnBy.join(', ')}`);
    if (deps.length > 0) md += deps.join(' · ') + '\n';
    if (mod.tests?.length) md += `Tests: ${mod.tests.join(', ')}\n`;
    for (const f of topFiles(mod, 10, { includeTests: true })) {
      const meta = [f.rank ? `rank ${f.rank}` : '', `${f.lines} lines`].filter(Boolean).join(', ');
      const ex = exportsSummary(f.exports, 4);
      md += `- \`${relativeToModule(f.file, mod.path)}\` (${meta})${ex ? ` — ${ex}` : ''}\n`;
    }
    const hidden = mod.fileCount - Math.min(10, mod.files.length);
    if (hidden > 0) md += `- … ${hidden} more\n`;
    md += '\n';
  }
  return md;
}

/** `## Code Map` section for query markdown. */
export function formatMapSection(map: CodeMap): string {
  return '## Code Map\n\n' + formatMapBody(map);
}

/**
 * One dense line for `prelude compact`. Modules containing only tests are
 * skipped unless the topic mentions tests.
 */
export function formatCompactMap(map: CodeMap, topic?: string): string {
  const parts: string[] = [];
  const hubs = (map.hubs ?? []).slice(0, 5);
  if (hubs.length > 0) {
    parts.push('hubs: ' + hubs.map(h => `${h.file}(${h.importedBy})`).join(', '));
  }
  const showTests = Boolean(topic && topic.toLowerCase().includes('test'));
  for (const mod of map.modules) {
    const onlyTests = mod.files.length > 0 && mod.files.every(f => f.isTest);
    if (onlyTests && !showTests) continue;
    const top = topFiles(mod, 3).map(f => relativeToModule(f.file, mod.path));
    const rest = mod.fileCount - top.length;
    const label = mod.purpose ? `${mod.path} (${mod.purpose})` : mod.path;
    parts.push(`${label}: ${top.join(', ')}${rest > 0 ? ` +${rest}` : ''}`);
  }
  return parts.length > 0 ? '[map] ' + parts.join(' | ') : '';
}

/**
 * Architecture block for CLAUDE.md / AGENTS.md: hubs to read first, then one
 * line per module with its key files.
 */
export function formatAgentGuideMap(map: CodeMap): string {
  let md = '';
  const hubs = (map.hubs ?? []).slice(0, 5);
  if (hubs.length > 0) {
    md += `**Read first:** ${hubs.map(h => `\`${h.file}\``).join(', ')}\n\n`;
  }
  const isConfig = (file: string) => /(^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(file);
  const modules = map.modules.filter(m => !m.files.every(f => f.isTest) || m.purpose);
  if (modules.length > 0) {
    md += '**Modules:**\n';
    for (const mod of modules) {
      const candidates = { ...mod, files: mod.files.filter(f => !isConfig(f.file)) };
      if (candidates.files.length === 0 && !mod.purpose && !mod.notes) continue;
      const key = topFiles(candidates, 3).map(f => {
        const name = relativeToModule(f.file, mod.path);
        const ex = (f.exports ?? []).slice(0, 2);
        return ex.length > 0 ? `${name} (${ex.join(', ')})` : name;
      });
      const path = mod.path === '.' ? '(root)' : `\`${mod.path}/\``;
      let line = `- ${path}`;
      if (mod.purpose) line += ` — ${mod.purpose}.`;
      if (mod.notes) line += ` ${mod.notes}`;
      if (key.length > 0) line += `${mod.purpose || mod.notes ? '' : ' —'} Key files: ${key.join(', ')}`;
      md += line + '\n';
    }
    md += '\n';
  }
  return md;
}
