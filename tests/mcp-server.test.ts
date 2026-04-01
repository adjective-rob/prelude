import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPreludeServer } from '../src/mcp/server.js';

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
