import { describe, it, expect } from 'vitest';
import { tokenize, locateInMap } from '../src/core/locate.js';
import type { CodeMap, Decisions, MapFile } from '../src/schema/index.js';

const f = (file: string, extra: Partial<MapFile> = {}): MapFile => ({ file, lang: 'ts', lines: 100, ...extra });

const map: CodeMap = {
  $schema: 'https://adjective.us/prelude/schemas/v1/map.schema.json',
  version: '1.0.0',
  stats: { files: 12, modules: 5, edges: 20, unresolvedImports: 0 },
  modules: [
    {
      path: 'src/commands',
      purpose: 'Command handlers',
      fileCount: 3,
      files: [
        f('src/commands/init.ts', { exports: ['registerInitCommand', 'initContext'], importedBy: 1, rank: 0.1 }),
        f('src/commands/serve.ts', { exports: ['registerServeCommand'], importedBy: 1, rank: 0.1 }),
        f('src/commands/update.ts', { exports: ['update'], importedBy: 1, rank: 0.1 }),
      ],
    },
    {
      path: 'src/core',
      purpose: 'Core business logic',
      fileCount: 4,
      files: [
        f('src/core/infer.ts', { exports: ['inferProjectMetadata', 'inferStack', 'inferArchitecture', 'inferConstraints'], importedBy: 3, rank: 0.25 }),
        f('src/core/merger.ts', { exports: ['ContextMerger', 'MergeResult', 'MergeChange'], importedBy: 2, rank: 0.17 }),
        f('src/core/query-engine.ts', { exports: ['executeQuery', 'exportCompact', 'VALID_TYPES'], importedBy: 3, rank: 0.25 }),
        f('src/core/state-manager.ts', { exports: ['StateManager'], importedBy: 2, rank: 0.17 }),
      ],
    },
    {
      path: 'src/mcp',
      purpose: 'MCP server',
      fileCount: 1,
      files: [f('src/mcp/server.ts', { exports: ['createPreludeServer'], importedBy: 1, rank: 0.08 })],
    },
    {
      path: 'src/utils',
      purpose: 'Utility functions',
      fileCount: 2,
      files: [
        f('src/utils/fs.ts', { exports: ['readJSON', 'writeJSON', 'fileExists'], importedBy: 12, rank: 1 }),
        f('src/utils/log.ts', { exports: ['logger', 'spinner'], importedBy: 9, rank: 0.75 }),
      ],
    },
    {
      path: 'tests',
      purpose: 'Tests',
      fileCount: 2,
      files: [
        f('tests/query.test.ts', { isTest: true }),
        f('tests/merge-preserve.test.ts', { isTest: true }),
      ],
    },
  ],
  hubs: [{ file: 'src/utils/fs.ts', importedBy: 12, rank: 1 }],
};

const decisions: Decisions = {
  $schema: 'https://adjective.us/prelude/schemas/v1/decisions.json',
  version: '1.0.0',
  decisions: [
    {
      id: 'd1',
      timestamp: '2025-01-01T00:00:00.000Z',
      title: 'Manual edits are sacred',
      status: 'accepted',
      rationale: 'src/core/merger.ts and src/core/state-manager.ts preserve manual edits during prelude update.',
    },
  ],
};

describe('tokenize', () => {
  it('splits camelCase, drops stopwords, and singularises', () => {
    expect(tokenize('How does inferArchitecture handle the tests?')).toEqual(['infer', 'architecture', 'handle', 'test']);
  });
});

describe('locateInMap', () => {
  it('finds infer.ts for "architecture inference"', () => {
    const hits = locateInMap(map, 'architecture inference');
    expect(hits[0].file).toBe('src/core/infer.ts');
    expect(hits[0].reasons).toContain('export inferArchitecture');
  });

  it('finds the MCP server first for "mcp server tools"', () => {
    expect(locateInMap(map, 'mcp server tools')[0].file).toBe('src/mcp/server.ts');
  });

  it('uses decisions to surface merger and state-manager', () => {
    const hits = locateInMap(map, 'preserve manual edits during update', {}, { decisions });
    const top3 = hits.slice(0, 3).map(h => h.file);
    expect(top3).toContain('src/core/merger.ts');
    expect(top3).toContain('src/core/state-manager.ts');
    expect(hits.find(h => h.file === 'src/core/merger.ts')?.reasons).toContain('decision: Manual edits are sacred');
  });

  it('admits test files only when the query mentions tests', () => {
    expect(locateInMap(map, 'query engine tests').map(h => h.file)).toContain('tests/query.test.ts');
    expect(locateInMap(map, 'query engine').map(h => h.file)).not.toContain('tests/query.test.ts');
  });

  it('restricts to a scope', () => {
    const hits = locateInMap(map, 'update merge infer', { scope: 'src/commands' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.file.startsWith('src/commands/'))).toBe(true);
  });

  it('returns [] when nothing matches', () => {
    expect(locateInMap(map, 'zzzz qqqq')).toEqual([]);
  });

  it('breaks ties by rank', () => {
    const tie: CodeMap = {
      ...map,
      modules: [{
        path: 'lib',
        fileCount: 2,
        files: [f('lib/a.ts', { exports: ['widget'], rank: 0.2 }), f('lib/b.ts', { exports: ['widget'], rank: 0.9 })],
      }],
    };
    expect(locateInMap(tie, 'widget').map(h => h.file)).toEqual(['lib/b.ts', 'lib/a.ts']);
  });

  it('honours the limit', () => {
    expect(locateInMap(map, 'src core commands utils', { limit: 2 })).toHaveLength(2);
  });
});
