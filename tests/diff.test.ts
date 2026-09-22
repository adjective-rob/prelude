import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { initContext } from '../src/commands/init.js';
import { computeDiff, formatChanges, type ContextChange } from '../src/core/diff.js';
import { annotateModule } from '../src/core/map-annotate.js';
import { formatDiffJson, formatDiffSummary } from '../src/commands/diff.js';
import { CONTEXT_DIR } from '../src/constants.js';

describe('computeDiff', () => {
  let rootDir: string;

  beforeAll(async () => {
    delete process.env.PRELUDE_ROOT;
    rootDir = await mkdtemp(join(tmpdir(), 'prelude-diff-'));
    await writeFile(join(rootDir, 'package.json'), JSON.stringify({ name: 'diff-fixture', version: '1.0.0' }));
    await mkdir(join(rootDir, 'src', 'core'), { recursive: true });
    await writeFile(join(rootDir, 'src', 'index.ts'), "import { run } from './core/run.js';\nrun();\n");
    await writeFile(join(rootDir, 'src', 'core', 'run.ts'), 'export function run() {}\n');
    await initContext(rootDir);
  });

  afterAll(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('reports no drift right after init', async () => {
    const diff = await computeDiff(rootDir);
    expect(diff.drift).toEqual([]);
  });

  it('reports a hand-edited purpose as preserved, not drift', async () => {
    await annotateModule(join(rootDir, CONTEXT_DIR), 'src/core', { purpose: 'The engine' });
    const diff = await computeDiff(rootDir);
    expect(diff.changes).toContainEqual(expect.objectContaining({
      file: 'map.json',
      field: 'modules.src/core.purpose',
      type: 'preserved',
    }));
    expect(diff.drift).toEqual([]);
  });

  it('reports a new module as drift in map.json and architecture.json', async () => {
    await mkdir(join(rootDir, 'src', 'newmod'), { recursive: true });
    await writeFile(join(rootDir, 'src', 'newmod', 'thing.ts'), 'export function thing() {}\n');
    const diff = await computeDiff(rootDir);
    expect(diff.drift).toContainEqual(expect.objectContaining({
      file: 'map.json', field: 'modules.src/newmod', type: 'added',
    }));
    expect(diff.drift).toContainEqual(expect.objectContaining({
      file: 'architecture.json', field: 'directories', type: 'added',
    }));
    await rm(join(rootDir, 'src', 'newmod'), { recursive: true, force: true });
  });
});

describe('diff formatting', () => {
  const changes: ContextChange[] = [
    { file: 'map.json', field: 'modules.src/a', type: 'added', newValue: 'src/a', reason: 'New module detected' },
    { file: 'map.json', field: 'modules.src/b', type: 'removed', oldValue: 'src/b', reason: 'Module no longer exists' },
    { file: 'stack.json', field: 'hubs', type: 'modified', oldValue: ['x'], newValue: ['y'], reason: 'Changed' },
  ];

  it('formatChanges groups by file with +/-/~ markers', () => {
    const out = formatChanges(changes, { color: false });
    expect(out).toContain('📄 map.json:');
    expect(out).toContain('📄 stack.json:');
    expect(out).toContain('  + modules.src/a');
    expect(out).toContain('  - modules.src/b');
    expect(out).toContain('  ~ hubs');
    expect(out).not.toContain('\x1b[');
  });

  it('formatDiffJson has the documented shape', () => {
    expect(formatDiffJson(changes)).toEqual({ changed: true, count: 3, changes });
    expect(formatDiffJson([])).toEqual({ changed: false, count: 0, changes: [] });
  });

  it('formatDiffSummary names the drift count', () => {
    expect(formatDiffSummary([])).toBe('Context is up to date.');
    expect(formatDiffSummary(changes)).toBe('Context has drifted: 3 changes. Run `prelude update`.');
  });
});
