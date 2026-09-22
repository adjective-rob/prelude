import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { writeJSON, ensureDir } from '../src/utils/fs.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../src/constants.js';
import { exportToClaudeMd, exportToMarkdown, saveExport } from '../src/core/exporter.js';

describe('CLAUDE.md export format', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prelude-export-test-'));
    const contextDir = join(tempDir, CONTEXT_DIR);
    await ensureDir(contextDir);

    await writeJSON(join(contextDir, CONTEXT_FILES.PROJECT), {
      name: 'test-project',
      description: 'A test project for validation',
      projectVersion: '2.0.0',
      license: 'MIT',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    await writeJSON(join(contextDir, CONTEXT_FILES.STACK), {
      language: 'TypeScript',
      runtime: 'Node.js >=18',
      packageManager: 'pnpm',
      frameworks: ['Next.js', 'React'],
      testingFrameworks: ['Vitest'],
      database: 'PostgreSQL',
      orm: 'Drizzle ORM',
    });

    await writeJSON(join(contextDir, CONTEXT_FILES.ARCHITECTURE), {
      type: 'fullstack',
      directories: [
        { path: 'src/app', purpose: 'Application routes' },
        { path: 'src/lib', purpose: 'Utility functions' },
      ],
      patterns: ['Server Components', 'API routes'],
      entryPoints: [{ file: 'src/index.ts', purpose: 'Main entry' }],
      keyFiles: [{ file: 'src/db.ts', role: 'database connection' }],
    });

    await writeJSON(join(contextDir, CONTEXT_FILES.CONSTRAINTS), {
      mustUse: ['TypeScript strict mode', 'Server Components by default'],
      mustNotUse: ['jQuery'],
      codeStyle: { linter: 'ESLint', formatter: 'Prettier' },
      testing: { required: true, strategy: 'Unit and integration tests' },
    });

    await writeJSON(join(contextDir, CONTEXT_FILES.DECISIONS), {
      decisions: [
        {
          title: 'Use Drizzle over Prisma',
          status: 'accepted',
          rationale: 'Better type inference and SQL control',
        },
      ],
    });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should generate valid CLAUDE.md format', async () => {
    const content = await exportToClaudeMd(tempDir);
    expect(content).toContain('# CLAUDE.md');
    expect(content).toContain('test-project');
  });

  it('should include stack information', async () => {
    const content = await exportToClaudeMd(tempDir);
    expect(content).toContain('TypeScript');
    expect(content).toContain('pnpm');
    expect(content).toContain('Next.js');
    expect(content).toContain('PostgreSQL');
  });

  it('should include architecture', async () => {
    const content = await exportToClaudeMd(tempDir);
    expect(content).toContain('fullstack');
    expect(content).toContain('src/app');
    expect(content).toContain('Application routes');
  });

  it('should include conventions/constraints', async () => {
    const content = await exportToClaudeMd(tempDir);
    expect(content).toContain('TypeScript strict mode');
    expect(content).toContain('ESLint');
    expect(content).toContain('jQuery');
  });

  it('should include decisions', async () => {
    const content = await exportToClaudeMd(tempDir);
    expect(content).toContain('Drizzle over Prisma');
  });

  it('should include key files', async () => {
    const content = await exportToClaudeMd(tempDir);
    expect(content).toContain('src/db.ts');
    expect(content).toContain('database connection');
  });
});

describe('export in external brain mode (PRELUDE_ROOT)', () => {
  let brainDir: string;
  let projectDir: string;
  const original = process.env.PRELUDE_ROOT;

  beforeAll(async () => {
    brainDir = await mkdtemp(join(tmpdir(), 'prelude-brain-'));
    projectDir = await mkdtemp(join(tmpdir(), 'prelude-brain-project-'));
    const contextDir = join(brainDir, basename(projectDir));
    await ensureDir(contextDir);
    await writeJSON(join(contextDir, CONTEXT_FILES.PROJECT), {
      name: 'brain-project',
      description: 'Lives in an external brain',
    });
  });

  afterAll(async () => {
    if (original === undefined) delete process.env.PRELUDE_ROOT;
    else process.env.PRELUDE_ROOT = original;
    await rm(brainDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('exportToMarkdown reads context from PRELUDE_ROOT', async () => {
    process.env.PRELUDE_ROOT = brainDir;
    const content = await exportToMarkdown(projectDir);
    expect(content).toContain('brain-project');
  });
});

describe('code map in agent guides', () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'prelude-agents-md-'));
    const contextDir = join(rootDir, CONTEXT_DIR);
    await ensureDir(contextDir);
    await writeJSON(join(contextDir, CONTEXT_FILES.PROJECT), { name: 'map-project', description: 'Has a map' });
    await writeJSON(join(contextDir, CONTEXT_FILES.ARCHITECTURE), {
      type: 'cli',
      directories: [{ path: 'src/core', purpose: 'Core business logic' }],
    });
  });

  afterAll(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('uses Key Directories when there is no map', async () => {
    const content = await exportToClaudeMd(rootDir);
    expect(content).toContain('**Key Directories:**');
    expect(content).not.toContain('**Read first:**');
  });

  it('uses the map when present, and writes AGENTS.md', async () => {
    await writeJSON(join(rootDir, CONTEXT_DIR, CONTEXT_FILES.MAP), {
      $schema: 'https://adjective.us/prelude/schemas/v1/map.schema.json',
      version: '1.0.0',
      stats: { files: 2, modules: 1, edges: 1, unresolvedImports: 0 },
      modules: [{
        path: 'src/core',
        purpose: 'Core business logic',
        fileCount: 2,
        files: [
          { file: 'src/core/a.ts', lang: 'ts', lines: 10, exports: ['alpha', 'beta', 'gamma'], importedBy: 1, rank: 1 },
          { file: 'src/core/b.ts', lang: 'ts', lines: 10, imports: ['src/core/a.ts'] },
        ],
      }],
      hubs: [{ file: 'src/core/a.ts', importedBy: 1, rank: 1 }],
    });

    const claude = await exportToClaudeMd(rootDir);
    expect(claude).toContain('**Read first:** `src/core/a.ts`');
    expect(claude).toContain('- `src/core/` — Core business logic. Key files: a.ts (alpha, beta), b.ts');
    expect(claude).not.toContain('**Key Directories:**');

    const path = await saveExport(rootDir, 'agents-md');
    expect(path.endsWith('AGENTS.md')).toBe(true);
    const agents = await readFile(path, 'utf-8');
    expect(agents.startsWith('# AGENTS.md')).toBe(true);
    expect(agents).toContain('**Modules:**');

    const md = await exportToMarkdown(rootDir);
    expect(md).toContain('## 🗺️ Code Map');
  });
});
