import { readdir } from 'fs/promises';
import { join } from 'path';
import { readJSON, fileExists } from '../utils/fs.js';
import type { PreludeState } from '../schema/state.js';

export interface HistoryFileChange {
  file: string;
  fields: string[];
}

export interface HistoryEntry {
  /** When the update ran: the backup's file name, e.g. 2026-10-18T01-17-35 */
  timestamp: string;
  /** Fields that update changed, by context file. Empty when nothing changed. */
  changes: HistoryFileChange[];
}

function fieldValues(state: PreludeState): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of state.files ?? []) {
    for (const [field, fs] of Object.entries(f.fields ?? {})) {
      out.set(`${f.file}\0${field}`, JSON.stringify(fs.value));
    }
  }
  return out;
}

/** Field-level changes between two state snapshots, grouped by file and sorted. */
export function diffStates(before: PreludeState, after: PreludeState): HistoryFileChange[] {
  const a = fieldValues(before);
  const b = fieldValues(after);
  const byFile = new Map<string, string[]>();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) === b.get(key)) continue;
    const [file, field] = key.split('\0');
    byFile.set(file, [...(byFile.get(file) ?? []), field]);
  }
  return [...byFile.keys()].sort().map(file => ({ file, fields: byFile.get(file)!.sort() }));
}

/**
 * Each backup in .prelude/history is the state just before an update, so
 * comparing it with the next backup (or the current state, for the newest)
 * shows what that update changed. Newest first. Unreadable backups are skipped.
 */
export async function listHistory(contextDir: string): Promise<HistoryEntry[]> {
  const historyDir = join(contextDir, '.prelude', 'history');
  let names: string[];
  try {
    names = (await readdir(historyDir)).filter(f => f.endsWith('.json')).sort();
  } catch {
    return [];
  }

  const snapshots: { timestamp: string; state: PreludeState }[] = [];
  for (const name of names) {
    try {
      snapshots.push({ timestamp: name.replace(/\.json$/, ''), state: await readJSON<PreludeState>(join(historyDir, name)) });
    } catch {
      // Skip unreadable backups
    }
  }

  let current: PreludeState | undefined;
  const statePath = join(contextDir, '.prelude', 'state.json');
  if (await fileExists(statePath)) {
    try {
      current = await readJSON<PreludeState>(statePath);
    } catch {
      // No current state to compare the newest backup with
    }
  }

  const entries: HistoryEntry[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const after = i + 1 < snapshots.length ? snapshots[i + 1].state : current;
    entries.push({ timestamp: snapshots[i].timestamp, changes: after ? diffStates(snapshots[i].state, after) : [] });
  }
  return entries.reverse();
}

/** `2026-10-18T01-17-35  project.json: projectVersion · stack.json: dependencies` */
export function formatHistoryLine(entry: HistoryEntry): string {
  const when = entry.timestamp.replace(/T(\d\d)-(\d\d)-(\d\d)$/, ' $1:$2:$3');
  if (entry.changes.length === 0) return `${when}  (no field changes)`;
  return `${when}  ${entry.changes.map(c => `${c.file}: ${c.fields.join(', ')}`).join(' · ')}`;
}
