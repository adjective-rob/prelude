import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StateManager, MAX_HISTORY } from '../src/core/state-manager.js';

describe('StateManager.backup', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  });

  it('keeps only the newest MAX_HISTORY backups', async () => {
    const contextDir = await mkdtemp(join(tmpdir(), 'prelude-history-'));
    dirs.push(contextDir);
    const historyDir = join(contextDir, '.prelude', 'history');
    await mkdir(historyDir, { recursive: true });
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      await writeFile(join(historyDir, `2020-01-01T00-00-${String(i).padStart(2, '0')}.json`), '{}');
    }

    new StateManager(contextDir).backup();

    const remaining = (await readdir(historyDir)).sort();
    expect(remaining).toHaveLength(MAX_HISTORY);
    expect(remaining).not.toContain('2020-01-01T00-00-00.json');
    expect(remaining.some(f => !f.startsWith('2020-'))).toBe(true);
  });
});
