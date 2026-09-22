import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import {
  addProject,
  removeProject,
  loadWorkspace,
  findProject,
  buildWorkspaceIndex,
} from '../src/core/workspace.js';

async function makeProject(root: string, dir: string, files: Record<string, unknown>): Promise<string> {
  const path = join(root, dir);
  await mkdir(join(path, '.context'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(path, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return path;
}

describe('workspace registry', () => {
  let root: string;
  let home: string;
  let alphaPath: string;
  let betaPath: string;
  const originalHome = process.env.PRELUDE_HOME;
  const originalRoot = process.env.PRELUDE_ROOT;

  beforeAll(async () => {
    delete process.env.PRELUDE_ROOT;
    root = await mkdtemp(join(tmpdir(), 'prelude-ws-'));
    home = join(root, 'home');
    process.env.PRELUDE_HOME = home;

    alphaPath = await makeProject(root, 'alpha', {
      'package.json': { name: 'alpha-web', dependencies: { '@acme/api': '^1.0.0', react: '^19' } },
      '.context/project.json': { name: 'alpha', description: 'Frontend', updatedAt: '2026-09-20T00:00:00.000Z' },
      '.context/stack.json': { language: 'TypeScript', frameworks: ['Next.js'] },
      '.context/decisions.json': { decisions: [{ id: '1', title: 'x', status: 'accepted', rationale: 'y', timestamp: '2026-01-01T00:00:00.000Z' }] },
    });
    betaPath = await makeProject(root, 'beta', {
      'package.json': { name: '@acme/api' },
      '.context/project.json': { name: 'beta', description: 'API' },
      '.context/stack.json': { language: 'Python', frameworks: ['FastAPI'] },
      '.context/architecture.json': {
        type: 'backend',
        directories: [],
        apiEndpoints: [
          { path: '/api/v1/stats', methods: ['GET'], file: 'app/routers/stats.py' },
          { path: '/api/v1/billing/checkout', methods: ['POST'], file: 'app/routers/billing.py' },
        ],
      },
      '.context/map.json': {
        $schema: 'x', version: '1.0.0',
        stats: { files: 1, modules: 1, edges: 0, unresolvedImports: 0 },
        modules: [{ path: 'app/routers', purpose: 'Route definitions', fileCount: 1, files: [{ file: 'app/routers/billing.py', lang: 'py', lines: 10 }] }],
        hubs: [{ file: 'app/db.py', importedBy: 9, rank: 1 }],
      },
    });
  });

  afterAll(async () => {
    if (originalHome === undefined) delete process.env.PRELUDE_HOME;
    else process.env.PRELUDE_HOME = originalHome;
    if (originalRoot !== undefined) process.env.PRELUDE_ROOT = originalRoot;
    await rm(root, { recursive: true, force: true });
  });

  it('adds a project named from project.json', async () => {
    await addProject(alphaPath);
    const ws = await loadWorkspace();
    expect(ws.projects).toHaveLength(1);
    expect(ws.projects[0]).toMatchObject({ name: 'alpha', path: alphaPath });
  });

  it('re-adding the same path updates the alias in place', async () => {
    await addProject(alphaPath, 'web');
    const ws = await loadWorkspace();
    expect(ws.projects).toHaveLength(1);
    expect(ws.projects[0].alias).toBe('web');
  });

  it('refuses a directory without context', async () => {
    const bare = join(root, 'bare');
    await mkdir(bare, { recursive: true });
    await expect(addProject(bare)).rejects.toThrow('Run `prelude init`');
  });

  it('indexes projects and infers shares-package relations', async () => {
    await addProject(betaPath);
    const index = await buildWorkspaceIndex();
    const alpha = index.projects.find(p => p.name === 'alpha')!;
    const beta = index.projects.find(p => p.name === 'beta')!;

    expect(beta.hasMap).toBe(true);
    expect(beta.apiEndpoints).toHaveLength(2);
    expect(beta.apiEndpointCount).toBe(2);
    expect(beta.hubs?.[0].file).toBe('app/db.py');
    expect(beta.packageName).toBe('@acme/api');
    expect(alpha.relatedProjects).toEqual([{ name: 'beta', relation: 'shares-package' }]);
    expect(alpha.decisionCount).toBe(1);
    expect(alpha.lastContextUpdate).toBe('2026-09-20T00:00:00.000Z');
  });

  it('puts manual relations first without a duplicate shares-package', async () => {
    await writeFile(join(alphaPath, '.context', 'project.json'), JSON.stringify({
      name: 'alpha',
      description: 'Frontend',
      relatedProjects: [{ name: 'beta', relation: 'consumes', contract: 'REST /api/v1' }],
    }));
    const index = await buildWorkspaceIndex();
    const alpha = index.projects.find(p => p.name === 'alpha')!;
    expect(alpha.relatedProjects).toEqual([{ name: 'beta', relation: 'consumes', contract: 'REST /api/v1' }]);
  });

  it('finds projects by alias, name, basename, and path, case-insensitively', async () => {
    const ws = await loadWorkspace();
    expect(findProject(ws, 'WEB')?.path).toBe(alphaPath);
    expect(findProject(ws, 'Beta')?.path).toBe(betaPath);
    expect(findProject(ws, basename(alphaPath).toUpperCase())?.path).toBe(alphaPath);
    expect(findProject(ws, betaPath)?.name).toBe('beta');
    expect(findProject(ws, 'nope')).toBeUndefined();
  });

  it('requires an alias when a different path reuses a name', async () => {
    const other = await makeProject(root, 'other', { '.context/project.json': { name: 'beta', description: 'dup' } });
    await expect(addProject(other)).rejects.toThrow('--alias');
    const entry = await addProject(other, 'beta2');
    expect(entry.alias).toBe('beta2');
    expect(await removeProject('beta2')).toBe(true);
  });

  it('marks deleted projects missing and removes them', async () => {
    await rm(betaPath, { recursive: true, force: true });
    const index = await buildWorkspaceIndex();
    expect(index.projects.find(p => p.name === 'beta')?.missing).toBe(true);
    expect(await removeProject('beta')).toBe(true);
    expect((await loadWorkspace()).projects.map(p => p.name)).toEqual(['alpha']);
  });
});
