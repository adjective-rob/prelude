import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeJSON, ensureDir } from '../src/utils/fs.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../src/constants.js';
import { exportToClaudeMd } from '../src/core/exporter.js';

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
