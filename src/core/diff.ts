import { join } from 'path';
import { readJSON } from '../utils/fs.js';
import { CONTEXT_FILES } from '../constants.js';
import { resolveContextDir } from '../runtime/context.js';
import { StateManager } from './state-manager.js';
import { ContextMerger, type MergeChange } from './merger.js';
import { buildMap } from './map-scanner.js';
import { inferProjectMetadata, inferStack, inferArchitecture, inferConstraints } from './infer.js';
import type { Project, Stack, Architecture, Constraints, CodeMap } from '../schema/index.js';

/**
 * Compute what `prelude update` would change, without writing anything.
 * Shared by `prelude update` and `prelude diff` so the two never disagree.
 */

export interface ContextChange extends MergeChange {
  file: string;
}

export interface ContextSet {
  project: Project;
  stack: Stack;
  architecture: Architecture;
  constraints: Constraints;
  map?: CodeMap;
}

export interface DiffResult {
  contextDir: string;
  changes: ContextChange[];   // everything, including 'preserved'
  drift: ContextChange[];     // changes minus 'preserved' minus ignored fields
  existing: Partial<ContextSet>;
  merged: ContextSet;
  inferred: ContextSet;
  /** State as mutated by the merge (hand edits detected). Not saved. */
  stateManager: StateManager;
}

/** Fields whose churn is never drift. */
const IGNORED_FIELDS = new Set(['project.json:updatedAt', 'project.json:createdAt']);

async function safeReadJSON<T>(path: string): Promise<T | undefined> {
  try {
    return await readJSON<T>(path);
  } catch {
    return undefined;
  }
}

export async function computeDiff(rootDir: string, opts: { onMapError?: (e: unknown) => void } = {}): Promise<DiffResult> {
  const contextDir = resolveContextDir(rootDir);

  const existingMap = await safeReadJSON<CodeMap>(join(contextDir, CONTEXT_FILES.MAP));
  const existing: Partial<ContextSet> = {
    project: await safeReadJSON<Project>(join(contextDir, CONTEXT_FILES.PROJECT)),
    stack: await safeReadJSON<Stack>(join(contextDir, CONTEXT_FILES.STACK)),
    architecture: await safeReadJSON<Architecture>(join(contextDir, CONTEXT_FILES.ARCHITECTURE)),
    constraints: await safeReadJSON<Constraints>(join(contextDir, CONTEXT_FILES.CONSTRAINTS)),
    map: existingMap && Array.isArray(existingMap.modules) ? existingMap : undefined,
  };

  const architecture = await inferArchitecture(rootDir);
  let map: CodeMap | undefined;
  try {
    map = await buildMap(rootDir, { architecture });
  } catch (error) {
    opts.onMapError?.(error);
  }
  const inferred: ContextSet = {
    project: await inferProjectMetadata(rootDir),
    stack: await inferStack(rootDir),
    architecture,
    constraints: await inferConstraints(rootDir),
    map,
  };

  const stateManager = new StateManager(contextDir);
  const merger = new ContextMerger(stateManager);
  const projectResult = merger.mergeProject(existing.project ?? ({} as Project), inferred.project);
  const stackResult = merger.mergeStack(existing.stack ?? ({} as Stack), inferred.stack);
  const archResult = merger.mergeArchitecture(existing.architecture ?? ({} as Architecture), inferred.architecture);
  const constraintsResult = merger.mergeConstraints(existing.constraints ?? ({} as Constraints), inferred.constraints);
  const mapResult = inferred.map ? merger.mergeMap(existing.map, inferred.map) : undefined;

  const changes: ContextChange[] = [
    ...projectResult.changes.map(c => ({ file: CONTEXT_FILES.PROJECT, ...c })),
    ...stackResult.changes.map(c => ({ file: CONTEXT_FILES.STACK, ...c })),
    ...archResult.changes.map(c => ({ file: CONTEXT_FILES.ARCHITECTURE, ...c })),
    ...constraintsResult.changes.map(c => ({ file: CONTEXT_FILES.CONSTRAINTS, ...c })),
    ...(mapResult?.changes ?? []).map(c => ({ file: CONTEXT_FILES.MAP, ...c })),
  ];

  const drift = changes.filter(c => c.type !== 'preserved' && !IGNORED_FIELDS.has(`${c.file}:${c.field}`));

  return {
    contextDir,
    changes,
    drift,
    existing,
    merged: {
      project: projectResult.merged,
      stack: stackResult.merged,
      architecture: archResult.merged,
      constraints: constraintsResult.merged,
      map: mapResult?.merged,
    },
    inferred,
    stateManager,
  };
}

const ICONS: Record<MergeChange['type'], string> = {
  added: '+ ',
  removed: '- ',
  modified: '~ ',
  preserved: '✓ ',
};

const COLORS: Record<MergeChange['type'], string> = {
  added: '\x1b[32m',
  removed: '\x1b[31m',
  modified: '\x1b[33m',
  preserved: '\x1b[36m',
};

const RESET = '\x1b[0m';

/** Render changes grouped by file. Returns a string; never prints. */
export function formatChanges(changes: ContextChange[], opts: { color: boolean }): string {
  const grouped = new Map<string, ContextChange[]>();
  for (const change of changes) {
    const list = grouped.get(change.file);
    if (list) list.push(change);
    else grouped.set(change.file, [change]);
  }

  const lines: string[] = [];
  for (const [file, fileChanges] of grouped) {
    lines.push(`📄 ${file}:`);
    for (const change of fileChanges) {
      const field = opts.color ? `${COLORS[change.type]}${change.field}${RESET}` : change.field;
      lines.push(`  ${ICONS[change.type]}${field} - ${change.reason}`);
      if (change.oldValue !== undefined) lines.push(`    Old: ${JSON.stringify(change.oldValue)}`);
      if (change.newValue !== undefined) lines.push(`    New: ${JSON.stringify(change.newValue)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
