import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPreludeServer } from '../src/mcp/server.js';
import { addProject } from '../src/core/workspace.js';
import { renderMcpConfig } from '../src/commands/mcp-config.js';

const f = (file: string, extra: Record<string, unknown> = {}) => ({ file, lang: 'ts', lines: 50, ...extra });

function mapOf(modules: unknown[], hubs: unknown[]) {
  return {
    $schema: 'https://adjective.us/prelude/schemas/v1/map.schema.json',
    version: '1.0.0',
    stats: { files: 3, modules: modules.length, edges: 2, unresolvedImports: 0 },
    modules,
    hubs,
  };
}

async function writeFiles(root: string, files: Record<string, unknown>) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

describe('Prelude MCP Server — workspace mode', () => {
  let root: string;
  let alphaPath: string;
  let betaPath: string;
  let client: Client;
  const originalHome = process.env.PRELUDE_HOME;

  const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as Array<{ type: string; text: string }>)[0].text;

  beforeAll(async () => {
    delete process.env.PRELUDE_ROOT;
    root = await mkdtemp(join(tmpdir(), 'prelude-mcp-ws-'));
    process.env.PRELUDE_HOME = join(root, 'home');
    alphaPath = join(root, 'alpha');
    betaPath = join(root, 'beta');

    await writeFiles(alphaPath, {
      '.context/project.json': { name: 'alpha', description: 'Web frontend' },
      '.context/stack.json': { language: 'TypeScript', frameworks: ['Next.js'] },
      '.context/decisions.json': { decisions: [] },
      '.context/map.json': mapOf(
        [{
          path: 'src/lib',
          purpose: 'Shared library code',
          fileCount: 2,
          files: [
            f('src/lib/api-client.ts', { exports: ['fetchStats', 'createCheckout'], importedBy: 4, rank: 1 }),
            f('src/lib/format.ts', { exports: ['formatMoney'] }),
          ],
        }],
        [{ file: 'src/lib/api-client.ts', importedBy: 4, rank: 1 }],
      ),
    });

    await writeFiles(betaPath, {
      '.context/project.json': { name: 'beta', description: 'Billing API' },
      '.context/stack.json': { language: 'Python', frameworks: ['FastAPI'] },
      '.context/architecture.json': {
        type: 'backend',
        directories: [],
        apiEndpoints: [
          { path: '/api/v1/billing/checkout', methods: ['POST'], file: 'app/routers/billing.py' },
          { path: '/api/v1/billing/webhook', methods: ['POST'], file: 'app/routers/billing.py' },
          { path: '/api/v1/stats', methods: ['GET'], file: 'app/routers/stats.py' },
        ],
      },
      '.context/map.json': mapOf(
        [{
          path: 'app/routers',
          purpose: 'Route definitions',
          fileCount: 2,
          files: [
            f('app/routers/billing.py', { lang: 'py', exports: ['checkout', 'stripe_webhook'], importedBy: 1, rank: 0.5 }),
            f('app/routers/stats.py', { lang: 'py', exports: ['get_stats'] }),
          ],
        }],
        [{ file: 'app/db.py', importedBy: 7, rank: 1 }],
      ),
    });

    await addProject(alphaPath);
    await addProject(betaPath);

    const server = createPreludeServer({ workspace: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    if (originalHome === undefined) delete process.env.PRELUDE_HOME;
    else process.env.PRELUDE_HOME = originalHome;
    await rm(root, { recursive: true, force: true });
  });

  it('registers workspace tools alongside the single-project tools', async () => {
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const name of [
      'prelude_projects', 'prelude_link_projects', 'prelude_workspace_refresh',
      'prelude_query', 'prelude_compact', 'prelude_status', 'prelude_locate',
      'prelude_map', 'prelude_record_decision', 'prelude_annotate_module',
    ]) {
      expect(names).toContain(name);
    }
    expect(client.getInstructions()).toContain('prelude_projects');
  });

  it('prelude_projects describes every project', async () => {
    const out = text(await client.callTool({ name: 'prelude_projects', arguments: {} }));
    expect(out).toContain('### alpha');
    expect(out).toContain('### beta');
    expect(out).toContain('API: 3 endpoints under /api/v1');
    expect(out).toContain('src/lib/api-client.ts (4)');
  });

  it('prelude_compact requires a project when several are registered', async () => {
    const result = await client.callTool({ name: 'prelude_compact', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('alpha');
    expect(text(result)).toContain('beta');
  });

  it('prelude_compact serves the named project', async () => {
    const out = text(await client.callTool({ name: 'prelude_compact', arguments: { project: 'beta' } }));
    expect(out).toContain('[stack] Python');
    expect(out).toContain('FastAPI');
  });

  it('prelude_locate searches one project or all of them', async () => {
    const one = await client.callTool({ name: 'prelude_locate', arguments: { query: 'checkout', project: 'alpha' } });
    const oneHits = (one._meta as { hits: Array<{ file: string; project: string }> }).hits;
    expect(oneHits.length).toBeGreaterThan(0);
    expect(oneHits.every(h => h.project === 'alpha' && h.file.startsWith('src/'))).toBe(true);

    const all = await client.callTool({ name: 'prelude_locate', arguments: { query: 'stripe webhook' } });
    const allHits = (all._meta as { hits: Array<{ file: string; project: string }> }).hits;
    expect(allHits[0]).toMatchObject({ project: 'beta', file: 'beta:app/routers/billing.py' });
    expect(text(all)).toContain('beta:app/routers/billing.py');
  });

  it('prelude_record_decision writes into the named project only', async () => {
    const result = await client.callTool({
      name: 'prelude_record_decision',
      arguments: { project: 'beta', title: 'Verify Stripe signatures', rationale: 'Reject forged webhooks' },
    });
    expect(result.isError).toBeFalsy();
    const beta = JSON.parse(await readFile(join(betaPath, '.context', 'decisions.json'), 'utf-8'));
    const alpha = JSON.parse(await readFile(join(alphaPath, '.context', 'decisions.json'), 'utf-8'));
    expect(beta.decisions.map((d: { title: string }) => d.title)).toEqual(['Verify Stripe signatures']);
    expect(alpha.decisions).toEqual([]);
  });

  it('prelude_link_projects records the relation and shows it in prelude_projects', async () => {
    const result = await client.callTool({
      name: 'prelude_link_projects',
      arguments: { from: 'alpha', to: 'beta', relation: 'consumes', contract: 'REST /api/v1' },
    });
    expect(result.isError).toBeFalsy();
    const project = JSON.parse(await readFile(join(alphaPath, '.context', 'project.json'), 'utf-8'));
    expect(project.relatedProjects).toEqual([{ name: 'beta', relation: 'consumes', contract: 'REST /api/v1' }]);

    const out = text(await client.callTool({ name: 'prelude_projects', arguments: {} }));
    expect(out).toContain('Related: consumes → beta (REST /api/v1)');
  });

  it('rejects an unknown project with the registered list', async () => {
    const result = await client.callTool({ name: 'prelude_map', arguments: { project: 'gamma' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Registered: alpha, beta');
  });

  it('prelude_workspace_refresh reports counts', async () => {
    const out = text(await client.callTool({ name: 'prelude_workspace_refresh', arguments: {} }));
    expect(out).toBe('Indexed 2 project(s): 2 with a map.');
  });

  it('serves the workspace index and per-project compact resources', async () => {
    const index = await client.readResource({ uri: 'prelude://workspace/index' });
    expect(JSON.parse(index.contents[0].text as string).projects).toHaveLength(2);
    const compact = await client.readResource({ uri: 'prelude://workspace/alpha/compact' });
    expect(compact.contents[0].text).toContain('[map]');
  });
});

describe('mcp-config --workspace rendering', () => {
  const spec = { name: 'prelude', command: '/usr/bin/prelude', args: ['serve', '--workspace'], env: { PRELUDE_HOME: '/h' } };

  it('prints a user-scope claude mcp add command', () => {
    const out = renderMcpConfig('claude-code', spec, true);
    expect(out).toContain('claude mcp add --scope user -e PRELUDE_HOME=/h prelude -- /usr/bin/prelude serve --workspace');
    expect(out).toContain('every session on this machine');
  });

  it('prints Codex TOML', () => {
    const out = renderMcpConfig('codex', spec, true);
    expect(out).toContain('[mcp_servers.prelude]');
    expect(out).toContain('args = ["serve", "--workspace"]');
    expect(out).toContain('PRELUDE_HOME = "/h"');
  });
});
