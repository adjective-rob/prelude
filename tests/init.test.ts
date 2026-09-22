import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { initContext } from '../src/commands/init.js';
import { validateContextDir } from '../src/commands/validate.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../src/constants.js';

describe('prelude init', () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'prelude-init-'));
    await writeFile(join(rootDir, 'package.json'), JSON.stringify({ name: 'init-fixture', version: '1.0.0' }));
    await mkdir(join(rootDir, 'src', 'core'), { recursive: true });
    await writeFile(join(rootDir, 'src', 'index.ts'), "import { run } from './core/run.js';\nrun();\n");
    await writeFile(join(rootDir, 'src', 'core', 'run.ts'), 'export function run() {}\n');
    await initContext(rootDir);
  });

  afterAll(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('writes map.json with modules', async () => {
    const raw = await readFile(join(rootDir, CONTEXT_DIR, CONTEXT_FILES.MAP), 'utf-8');
    const map = JSON.parse(raw);
    expect(map.modules.length).toBeGreaterThan(0);
    expect(map.modules.map((m: { path: string }) => m.path)).toContain('src/core');
  });

  it('produces files that pass validation', async () => {
    const results = await validateContextDir(join(rootDir, CONTEXT_DIR));
    const mapResult = results.find(r => r.file === CONTEXT_FILES.MAP);
    expect(mapResult?.status).toBe('valid');
    expect(results.filter(r => r.status === 'invalid')).toEqual([]);
  });
});
