import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPreludeServer } from '../src/mcp/server.js';
import { StateManager } from '../src/core/state-manager.js';
import { ContextMerger } from '../src/core/merger.js';

describe('Prelude MCP Server', () => {
  let tmpDir: string;
  let client: Client;

  beforeAll(async () => {
    // Ensure PRELUDE_ROOT doesn't interfere with test paths
    delete process.env.PRELUDE_ROOT;

    tmpDir = await mkdtemp(join(tmpdir(), 'prelude-mcp-test-'));
    const contextDir = join(tmpDir, '.context');
    await mkdir(contextDir, { recursive: true });

    await Promise.all([
      writeFile(join(contextDir, 'project.json'), JSON.stringify({
        $schema: 'https://adjective.us/prelude/schemas/v1/project.schema.json',
        version: '1.0.0',
        name: 'test-project',
        description: 'A test project for MCP server validation',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      })),
      writeFile(join(contextDir, 'stack.json'), JSON.stringify({
        $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
        version: '1.0.0',
        language: 'TypeScript',
        runtime: 'Node.js 20',
        packageManager: 'pnpm',
        frameworks: ['Next.js', 'React'],
        testingFrameworks: ['Vitest'],
        database: 'PostgreSQL',
        orm: 'Drizzle ORM',
      })),
      writeFile(join(contextDir, 'constraints.json'), JSON.stringify({
        $schema: 'https://adjective.us/prelude/schemas/v1/constraints.schema.json',
        version: '1.0.0',
        mustUse: ['TypeScript for type safety', 'Tailwind CSS for styling'],
        mustNotUse: ['Default exports'],
        testing: { required: true, strategy: 'Unit and integration tests' },
      })),
    ]);

    const server = createPreludeServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Tool Tests ---

  it('prelude_status returns available files and project info', async () => {
    const result = await client.callTool({ name: 'prelude_status', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');

    const status = JSON.parse(content[0].text);
    expect(status.files).toContain('project.json');
    expect(status.files).toContain('stack.json');
    expect(status.files).toContain('constraints.json');
    expect(status.project.name).toBe('test-project');
  });

  it('prelude_query returns context filtered by type', async () => {
    const result = await client.callTool({
      name: 'prelude_query',
      arguments: { type: 'stack', format: 'json' },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');

    const parsed = JSON.parse(content[0].text);
    expect(parsed.stack).toBeDefined();
    expect(parsed.stack.language).toBe('TypeScript');
  });

  it('prelude_query returns context filtered by topic', async () => {
    const result = await client.callTool({
      name: 'prelude_query',
      arguments: { topic: 'database', format: 'md' },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0].text;
    expect(text.toLowerCase()).toMatch(/postgres|drizzle/);
  });

  it('prelude_query errors when no filter provided', async () => {
    const result = await client.callTool({
      name: 'prelude_query',
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text.toLowerCase()).toContain('provide');
  });

  it('prelude_compact returns token-efficient output', async () => {
    const result = await client.callTool({
      name: 'prelude_compact',
      arguments: { max_tokens: 500 },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0].text;

    expect(text).toContain('[stack]');
    expect(text).toContain('TypeScript');
  });

  // --- Resource Tests ---

  it('full-context resource returns markdown export', async () => {
    const result = await client.readResource({ uri: 'prelude://context/full' });
    const content = result.contents[0];
    expect(content.mimeType).toBe('text/markdown');
    expect(content.text).toContain('test-project');
    expect(content.text).toContain('TypeScript');
  });

  it('compact-context resource returns compact output', async () => {
    const result = await client.readResource({ uri: 'prelude://context/compact' });
    const content = result.contents[0];
    expect(content.mimeType).toBe('text/plain');
    expect(content.text).toContain('[stack]');
  });

  it('context-by-type resource returns specific context file', async () => {
    const result = await client.readResource({ uri: 'prelude://context/stack' });
    const content = result.contents[0];
    expect(content.mimeType).toBe('application/json');
    const data = JSON.parse(content.text as string);
    expect(data.language).toBe('TypeScript');
  });

  it('context-by-type resource handles missing files gracefully', async () => {
    const result = await client.readResource({ uri: 'prelude://context/decisions' });
    const content = result.contents[0];
    expect(content.text).toContain('not found');
  });

  it('context-by-type resource handles invalid types gracefully', async () => {
    const result = await client.readResource({ uri: 'prelude://context/invalid' });
    const content = result.contents[0];
    expect(content.text).toContain('Unknown context type');
  });
});

describe('Prelude MCP Server — map, locate, and write tools', () => {
  let tmpDir: string;
  let contextDir: string;
  let client: Client;

  const f = (file: string, extra: Record<string, unknown> = {}) => ({ file, lang: 'ts', lines: 100, ...extra });
  const mapFixture = {
    $schema: 'https://adjective.us/prelude/schemas/v1/map.schema.json',
    version: '1.0.0',
    stats: { files: 5, modules: 3, edges: 4, unresolvedImports: 0 },
    modules: [
      {
        path: 'src/core',
        purpose: 'Core business logic',
        fileCount: 2,
        files: [
          f('src/core/merger.ts', { exports: ['ContextMerger', 'MergeResult'], imports: ['src/utils/fs.ts'], importedBy: 1, rank: 0.5 }),
          f('src/core/infer.ts', { exports: ['inferStack', 'inferArchitecture'], imports: ['src/utils/fs.ts'], importedBy: 1, rank: 0.5 }),
        ],
        dependsOn: ['src/utils'],
      },
      {
        path: 'src/mcp',
        purpose: 'MCP server',
        fileCount: 1,
        files: [f('src/mcp/server.ts', { exports: ['createPreludeServer'], imports: ['src/core/merger.ts', 'src/core/infer.ts'] })],
        dependsOn: ['src/core'],
      },
      {
        path: 'src/utils',
        purpose: 'Utility functions',
        fileCount: 1,
        files: [f('src/utils/fs.ts', { exports: ['readJSON', 'writeJSON'], importedBy: 2, rank: 1 })],
        dependedOnBy: ['src/core'],
      },
    ],
    hubs: [{ file: 'src/utils/fs.ts', importedBy: 2, rank: 1, exports: ['readJSON', 'writeJSON'] }],
  };

  const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as Array<{ type: string; text: string }>)[0].text;

  beforeAll(async () => {
    delete process.env.PRELUDE_ROOT;
    tmpDir = await mkdtemp(join(tmpdir(), 'prelude-mcp-map-test-'));
    contextDir = join(tmpDir, '.context');
    await mkdir(contextDir, { recursive: true });
    await writeFile(join(contextDir, 'project.json'), JSON.stringify({ name: 'map-project', description: 'x' }));
    await writeFile(join(contextDir, 'architecture.json'), JSON.stringify({ type: 'cli', directories: [] }));
    await writeFile(join(contextDir, 'map.json'), JSON.stringify(mapFixture));

    const server = createPreludeServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('lists exactly the seven tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual([
      'prelude_annotate_module',
      'prelude_compact',
      'prelude_locate',
      'prelude_map',
      'prelude_query',
      'prelude_record_decision',
      'prelude_status',
    ]);
  });

  it('sends server instructions', () => {
    expect(client.getInstructions()).toContain('prelude_locate');
  });

  it('prelude_locate returns ranked files with hits in _meta', async () => {
    const result = await client.callTool({ name: 'prelude_locate', arguments: { query: 'mcp server' } });
    expect(text(result).split('\n')[0]).toMatch(/^1\. src\/mcp\/server\.ts/);
    const hits = (result._meta as { hits: Array<{ file: string }> }).hits;
    expect(hits[0].file).toBe('src/mcp/server.ts');
  });

  it('prelude_locate rejects an empty query', async () => {
    const result = await client.callTool({ name: 'prelude_locate', arguments: { query: '  ' } });
    expect(result.isError).toBe(true);
  });

  it('prelude_map overview lists hubs and every module', async () => {
    const out = text(await client.callTool({ name: 'prelude_map', arguments: {} }));
    expect(out).toContain('Read first');
    for (const m of mapFixture.modules) expect(out).toContain(m.path);
  });

  it('prelude_map module view shows exports; bogus module lists valid paths', async () => {
    const out = text(await client.callTool({ name: 'prelude_map', arguments: { module: 'src/core' } }));
    expect(out).toContain('ContextMerger');
    expect(out).toContain('inferArchitecture');

    const bad = await client.callTool({ name: 'prelude_map', arguments: { module: 'src/nope' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('src/core, src/mcp, src/utils');
  });

  it('prelude_map file view shows imports and importers', async () => {
    const out = text(await client.callTool({ name: 'prelude_map', arguments: { file: 'src/utils/fs.ts' } }));
    expect(out).toContain('Exports: readJSON, writeJSON');
    expect(out).toContain('Imported by 2');
  });

  it('prelude_record_decision writes decisions.json with author agent', async () => {
    const result = await client.callTool({
      name: 'prelude_record_decision',
      arguments: { title: 'Use regex, not AST', rationale: 'No heavy dependencies', tags: ['scanner'] },
    });
    expect(result.isError).toBeFalsy();
    const saved = JSON.parse(await readFile(join(contextDir, 'decisions.json'), 'utf-8'));
    expect(saved.$schema).toContain('https://adjective.us/prelude/schemas/v1');
    expect(saved.decisions).toHaveLength(1);
    expect(saved.decisions[0]).toMatchObject({ title: 'Use regex, not AST', author: 'agent', status: 'accepted' });
  });

  it('prelude_annotate_module sets a manual purpose that survives mergeMap', async () => {
    const result = await client.callTool({
      name: 'prelude_annotate_module',
      arguments: { path: 'src/core/', purpose: 'Inference engine', notes: 'Regex heuristics only' },
    });
    expect(text(result)).toContain('src/core — Inference engine');

    const state = new StateManager(contextDir);
    expect(state.isManuallyEdited('map.json', 'modules.src/core.purpose')).toBe(true);

    const existing = JSON.parse(await readFile(join(contextDir, 'map.json'), 'utf-8'));
    const { merged } = new ContextMerger(state).mergeMap(existing, mapFixture as never);
    const core = merged.modules.find(m => m.path === 'src/core');
    expect(core?.purpose).toBe('Inference engine');
    expect(core?.notes).toBe('Regex heuristics only');
  });
});
