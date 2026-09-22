import type { IndexedProject, WorkspaceIndex } from '../schema/index.js';

const MAX_MODULES = 8;
const MAX_ENDPOINT_SAMPLES = 3;

function tildify(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
}

/** Longest common path-segment prefix of endpoint paths, e.g. `/api/v1`. */
function commonPrefix(paths: string[]): string {
  if (paths.length < 2) return '';
  const split = paths.map(p => p.split('/').filter(Boolean));
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const seg = split[0][i];
    if (seg === undefined || seg.startsWith('{') || seg.startsWith(':') || seg.startsWith('[')) break;
    if (!split.every(s => s[i] === seg)) break;
    out.push(seg);
  }
  return out.length > 0 ? '/' + out.join('/') : '';
}

export function formatProjectBlock(p: IndexedProject): string {
  const label = p.alias ? `${p.name} (alias: ${p.alias})` : p.name;
  if (p.missing) return `### ${label} — MISSING (${tildify(p.path)})\n`;

  const lines: string[] = [`### ${label}  (${tildify(p.path)})`];

  const summary = [
    p.description,
    p.type,
    p.language,
    p.frameworks?.length ? p.frameworks.join(', ') : undefined,
  ].filter(Boolean);
  if (summary.length > 0) lines.push(summary.join(' · '));

  if (p.entryPoints?.length) {
    lines.push('Entry: ' + p.entryPoints.slice(0, 3).map(e => `${e.file} (${e.purpose})`).join(', '));
  }

  const endpoints = p.apiEndpoints ?? [];
  if (endpoints.length > 0) {
    const total = p.apiEndpointCount ?? endpoints.length;
    const prefix = commonPrefix(endpoints.map(e => e.path));
    const samples = endpoints.slice(0, MAX_ENDPOINT_SAMPLES).map(e => `${e.methods.join('/')} ${e.path}`);
    const more = total - samples.length;
    lines.push(
      `API: ${total} endpoint${total === 1 ? '' : 's'}${prefix ? ` under ${prefix}` : ''} ` +
      `(${samples.join(', ')}${more > 0 ? `, +${more}` : ''})`
    );
  }

  if (p.hubs?.length) {
    lines.push('Read first: ' + p.hubs.map(h => `${h.file} (${h.importedBy})`).join(', '));
  }

  if (p.modules?.length) {
    const shown = p.modules.slice(0, MAX_MODULES).map(m => (m.purpose ? `${m.path} (${m.purpose})` : m.path));
    const more = p.modules.length - shown.length;
    lines.push(`Modules: ${shown.join(', ')}${more > 0 ? ` +${more}` : ''}`);
  } else if (!p.hasMap) {
    lines.push('Modules: no map.json yet (run `prelude update` in the project)');
  }

  if (p.relatedProjects?.length) {
    lines.push('Related: ' + p.relatedProjects
      .map(r => `${r.relation} → ${r.name}${r.contract ? ` (${r.contract})` : ''}`)
      .join('; '));
  }

  const tail: string[] = [];
  if (p.decisionCount !== undefined) tail.push(`Decisions: ${p.decisionCount}`);
  if (p.lastContextUpdate) tail.push(`context updated ${p.lastContextUpdate.slice(0, 10)}`);
  if (tail.length > 0) lines.push(tail.join(' · '));

  return lines.join('\n') + '\n';
}

export function formatProjects(index: WorkspaceIndex): string {
  if (index.projects.length === 0) {
    return 'No projects registered. Run `prelude workspace add <path>` in each project.\n';
  }
  return index.projects.map(formatProjectBlock).join('\n');
}
