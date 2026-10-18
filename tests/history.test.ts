import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listHistory, formatHistoryLine } from '../src/core/history.js';

function state(fields: Record<string, Record<string, unknown>>) {
  return {
    version: '1.0.0',
    initialized: '2026-01-01T00:00:00.000Z',
    lastUpdate: '2026-01-01T00:00:00.000Z',
    files: Object.entries(fields).map(([file, f]) => ({
      file,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      fields: Object.fromEntries(Object.entries(f).map(([k, value]) => [k, { value, source: 'inferred' }])),
    })),
  };
}

describe('listHistory', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  });

  async function setup(backups: Record<string, unknown>, current?: unknown): Promise<string> {
    const contextDir = await mkdtemp(join(tmpdir(), 'prelude-hist-'));
    dirs.push(contextDir);
    const historyDir = join(contextDir, '.prelude', 'history');
    await mkdir(historyDir, { recursive: true });
    for (const [name, s] of Object.entries(backups)) {
      await writeFile(join(historyDir, `${name}.json`), typeof s === 'string' ? s : JSON.stringify(s));
    }
    if (current) await writeFile(join(contextDir, '.prelude', 'state.json'), JSON.stringify(current));
    return contextDir;
  }

  it('returns an empty list when there is no history', async () => {
    const contextDir = await mkdtemp(join(tmpdir(), 'prelude-hist-'));
    dirs.push(contextDir);
    expect(await listHistory(contextDir)).toEqual([]);
  });

  it('diffs each backup against the next one, and the newest against the current state', async () => {
    const contextDir = await setup(
      {
        '2026-01-01T00-00-00': state({ 'project.json': { name: 'a', version: '1' } }),
        '2026-01-02T00-00-00': state({ 'project.json': { name: 'a', version: '2' } }),
      },
      state({ 'project.json': { name: 'b', version: '2' }, 'stack.json': { language: 'TypeScript' } }),
    );

    const entries = await listHistory(contextDir);
    expect(entries.map(e => e.timestamp)).toEqual(['2026-01-02T00-00-00', '2026-01-01T00-00-00']);
    expect(entries[0].changes).toEqual([
      { file: 'project.json', fields: ['name'] },
      { file: 'stack.json', fields: ['language'] },
    ]);
    expect(entries[1].changes).toEqual([{ file: 'project.json', fields: ['version'] }]);
    expect(formatHistoryLine(entries[1])).toBe('2026-01-01 00:00:00  project.json: version');
  });

  it('skips unreadable backups', async () => {
    const contextDir = await setup({
      '2026-01-01T00-00-00': 'not json',
      '2026-01-02T00-00-00': state({ 'project.json': { name: 'a' } }),
    });
    const entries = await listHistory(contextDir);
    expect(entries).toHaveLength(1);
    expect(formatHistoryLine(entries[0])).toBe('2026-01-02 00:00:00  (no field changes)');
  });
});
