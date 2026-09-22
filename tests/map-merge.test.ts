import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateManager } from '../src/core/state-manager.js';
import { ContextMerger, trackMapFields } from '../src/core/merger.js';
import type { CodeMap, MapModule } from '../src/schema/index.js';

function mod(path: string, files: string[], extra: Partial<MapModule> = {}): MapModule {
  return {
    path,
    fileCount: files.length,
    files: files.map(file => ({ file, lang: 'ts' as const, lines: 10 })),
    ...extra,
  };
}

function map(modules: MapModule[], hubs: string[] = []): CodeMap {
  return {
    $schema: 'https://adjective.us/prelude/schemas/v1/map.schema.json',
    version: '1.0.0',
    stats: { files: 0, modules: modules.length, edges: 0, unresolvedImports: 0 },
    modules,
    ...(hubs.length ? { hubs: hubs.map((file, i) => ({ file, importedBy: 10 - i, rank: 1 })) } : {}),
  };
}

describe('ContextMerger.mergeMap', () => {
  let dir: string;
  let state: StateManager;
  let merger: ContextMerger;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prelude-map-merge-'));
    state = new StateManager(dir);
    merger = new ContextMerger(state);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns inferred with one added change when no map exists', () => {
    const inferred = map([mod('src/core', ['src/core/a.ts'])]);
    const result = merger.mergeMap(undefined, inferred);
    expect(result.merged).toEqual(inferred);
    expect(result.changes).toEqual([expect.objectContaining({ field: 'map', type: 'added' })]);
  });

  it('preserves notes', () => {
    const existing = map([mod('src/core', ['src/core/a.ts'], { notes: 'Start at a.ts' })]);
    const inferred = map([mod('src/core', ['src/core/a.ts'])]);
    const result = merger.mergeMap(existing, inferred);
    expect(result.merged.modules[0].notes).toBe('Start at a.ts');
    expect(result.changes).toHaveLength(0);
  });

  it('keeps a purpose tracked as manual', () => {
    state.trackManual('map.json', 'modules.src/core.purpose', 'Inference engine');
    const existing = map([mod('src/core', ['src/core/a.ts'], { purpose: 'Inference engine' })]);
    const inferred = map([mod('src/core', ['src/core/a.ts'], { purpose: 'Core business logic' })]);
    const result = merger.mergeMap(existing, inferred);
    expect(result.merged.modules[0].purpose).toBe('Inference engine');
    expect(result.changes).toEqual([
      expect.objectContaining({ field: 'modules.src/core.purpose', type: 'preserved' }),
    ]);
  });

  it('detects a hand edit against the last inferred hash and tracks it manual', () => {
    const original = map([mod('src/core', ['src/core/a.ts'], { purpose: 'Core business logic' })]);
    trackMapFields(state, original, original);

    const edited = map([mod('src/core', ['src/core/a.ts'], { purpose: 'Inference engine' })]);
    const result = merger.mergeMap(edited, original);
    expect(result.merged.modules[0].purpose).toBe('Inference engine');
    expect(result.changes[0]).toMatchObject({ type: 'preserved' });
    expect(state.isManuallyEdited('map.json', 'modules.src/core.purpose')).toBe(true);
  });

  it('takes a new inferred purpose when the old one was never edited', () => {
    const original = map([mod('src/core', ['src/core/a.ts'], { purpose: 'Old' })]);
    trackMapFields(state, original, original);
    const inferred = map([mod('src/core', ['src/core/a.ts'], { purpose: 'New' })]);
    const result = merger.mergeMap(original, inferred);
    expect(result.merged.modules[0].purpose).toBe('New');
  });

  it('reports removed and added modules', () => {
    const existing = map([mod('src/old', ['src/old/a.ts'])]);
    const inferred = map([mod('src/new', ['src/new/a.ts'])]);
    const result = merger.mergeMap(existing, inferred);
    expect(result.changes.filter(c => c.type === 'added')).toHaveLength(1);
    expect(result.changes.filter(c => c.type === 'removed')).toHaveLength(1);
  });

  it('reports file set changes per module', () => {
    const existing = map([mod('src/core', ['src/core/a.ts', 'src/core/b.ts'])]);
    const inferred = map([mod('src/core', ['src/core/a.ts', 'src/core/c.ts'])]);
    const result = merger.mergeMap(existing, inferred);
    expect(result.changes).toEqual([
      expect.objectContaining({
        field: 'modules.src/core.files',
        type: 'modified',
        oldValue: ['src/core/b.ts'],
        newValue: ['src/core/c.ts'],
      }),
    ]);
  });

  it('reports a hub reorder as exactly one change', () => {
    const modules = [mod('src', ['src/a.ts', 'src/b.ts'])];
    const result = merger.mergeMap(map(modules, ['src/a.ts', 'src/b.ts']), map(modules, ['src/b.ts', 'src/a.ts']));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ field: 'hubs', type: 'modified' });
  });

  it('ignores rank churn', () => {
    const existing = map([mod('src', ['src/a.ts'])], ['src/a.ts']);
    const inferred = map([mod('src', ['src/a.ts'])], ['src/a.ts']);
    inferred.modules[0].files[0].rank = 0.42;
    inferred.hubs![0].rank = 0.42;
    const result = merger.mergeMap(existing, inferred);
    expect(result.changes).toHaveLength(0);
  });
});
