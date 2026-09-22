import { join } from 'path';
import { readJSON, writeJSON, fileExists } from '../utils/fs.js';
import { CONTEXT_FILES } from '../constants.js';
import { StateManager } from './state-manager.js';
import type { CodeMap, MapModule } from '../schema/index.js';

export interface AnnotateInput {
  purpose?: string;
  notes?: string;
  clearNotes?: boolean;
}

export function normalizeModulePath(modulePath: string): string {
  const p = modulePath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return p === '' ? '.' : p;
}

/**
 * Set a module's purpose and/or notes in map.json. A purpose set here is
 * tracked as manual so prelude update never overwrites it; notes are
 * always preserved by the merger.
 */
export async function annotateModule(contextDir: string, modulePath: string, input: AnnotateInput): Promise<MapModule> {
  const mapPath = join(contextDir, CONTEXT_FILES.MAP);
  if (!(await fileExists(mapPath))) {
    throw new Error('map.json not found. Run `prelude update` to build it.');
  }
  const map = await readJSON<CodeMap>(mapPath);
  const path = normalizeModulePath(modulePath);
  const mod = map.modules.find(m => m.path === path);
  if (!mod) {
    throw new Error(`Module "${path}" not found. Valid modules: ${map.modules.map(m => m.path).join(', ')}`);
  }

  const purpose = input.purpose?.trim();
  if (purpose) mod.purpose = purpose;
  if (input.clearNotes) delete mod.notes;
  const notes = input.notes?.trim();
  if (notes) mod.notes = notes;

  // Keep path/purpose/notes at the top of the module object
  const { path: p, purpose: pu, notes: n, ...rest } = mod;
  const ordered = { path: p, ...(pu !== undefined ? { purpose: pu } : {}), ...(n !== undefined ? { notes: n } : {}), ...rest } as MapModule;
  map.modules = map.modules.map(m => (m.path === path ? ordered : m));
  await writeJSON(mapPath, map);

  if (purpose) {
    const state = new StateManager(contextDir);
    state.trackManual(CONTEXT_FILES.MAP, `modules.${path}.purpose`, purpose);
    state.save();
  }
  return ordered;
}

/** One-line summary: `src/core — Core business logic (12 files) · notes: …` */
export function formatModuleLine(mod: MapModule): string {
  let line = `${mod.path}${mod.purpose ? ` — ${mod.purpose}` : ''} (${mod.fileCount} files)`;
  if (mod.notes) line += ` · notes: ${mod.notes}`;
  return line;
}
