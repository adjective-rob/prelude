import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { executeQuery, exportCompact } from '../src/core/query-engine.js';

const TEST_DIR = join(tmpdir(), 'prelude-query-test-' + Date.now());
const CONTEXT_DIR = join(TEST_DIR, '.context');

const fixtures = {
  project: {
    $schema: 'https://adjective.us/prelude/schemas/v1/project.json',
    version: '1.0.0',
    name: 'test-project',
    description: 'A test project for error handling validation',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    goals: ['Robust error handling', 'Type safety'],
  },
  stack: {
    $schema: 'https://adjective.us/prelude/schemas/v1/stack.json',
    version: '1.0.0',
    language: 'TypeScript',
    runtime: 'Node.js',
    packageManager: 'pnpm',
    frameworks: ['Express'],
    testingFrameworks: ['Vitest'],
    database: 'PostgreSQL',
    orm: 'Prisma',
  },
  architecture: {
    $schema: 'https://adjective.us/prelude/schemas/v1/architecture.json',
    version: '1.0.0',
    type: 'backend',
    directories: [
      { path: 'src/api', purpose: 'REST API endpoints' },
      { path: 'src/api/middleware', purpose: 'Express middleware for error handling' },
      { path: 'src/services', purpose: 'Business logic services' },
      { path: 'src/models', purpose: 'Database models' },
      { path: 'tests', purpose: 'Test files' },
    ],
    patterns: ['Service layer', 'Repository pattern', 'Error boundary middleware'],
    conventions: ['camelCase for files', 'PascalCase for classes'],
    entryPoints: [{ file: 'src/api/index.ts', purpose: 'API server entry' }],
    routing: 'config-based' as const,
    apiStyle: 'REST' as const,
  },
  constraints: {
    $schema: 'https://adjective.us/prelude/schemas/v1/constraints.json',
    version: '1.0.0',
    mustUse: ['TypeScript strict mode', 'Prisma for database access'],
    mustNotUse: ['any type', 'console.log in production'],
    codeStyle: { formatter: 'Prettier', linter: 'ESLint' },
    testing: { required: true, strategy: 'Unit + integration', coverage: 80 },
    naming: { files: 'camelCase', components: 'PascalCase', functions: 'camelCase', variables: 'camelCase' },
    fileOrganization: ['Group by feature in src/api', 'Shared utils in src/utils'],
    security: ['Validate all inputs', 'Use parameterized queries'],
  },
  decisions: {
    $schema: 'https://adjective.us/prelude/schemas/v1/decisions.json',
    version: '1.0.0',
    decisions: [
      {
        id: 'dec-001',
        timestamp: '2025-01-01T00:00:00.000Z',
        title: 'Use Prisma for database ORM',
        status: 'accepted' as const,
        rationale: 'Type-safe database access with good migration support',
        alternatives: ['TypeORM', 'Drizzle'],
        impact: 'All database access must go through Prisma client',
        tags: ['database', 'orm'],
      },
      {
        id: 'dec-002',
        timestamp: '2025-01-02T00:00:00.000Z',
        title: 'Centralized error handling middleware',
        status: 'accepted' as const,
        rationale: 'Consistent error responses and logging',
        alternatives: ['Per-route error handling'],
        impact: 'All errors flow through global handler',
        tags: ['error-handling', 'api'],
      },
    ],
  },
};

beforeEach(async () => {
  await mkdir(CONTEXT_DIR, { recursive: true });
  await Promise.all([
    writeFile(join(CONTEXT_DIR, 'project.json'), JSON.stringify(fixtures.project)),
    writeFile(join(CONTEXT_DIR, 'stack.json'), JSON.stringify(fixtures.stack)),
    writeFile(join(CONTEXT_DIR, 'architecture.json'), JSON.stringify(fixtures.architecture)),
    writeFile(join(CONTEXT_DIR, 'constraints.json'), JSON.stringify(fixtures.constraints)),
    writeFile(join(CONTEXT_DIR, 'decisions.json'), JSON.stringify(fixtures.decisions)),
  ]);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('prelude query', () => {
  describe('topic-based queries', () => {
    it('should find "error handling" across multiple context types', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        topic: 'error handling',
        format: 'md',
      });

      expect(output).toContain('error handling');
      // Should match architecture (middleware directory, patterns)
      expect(output).toContain('Architecture');
      // Should match decisions (centralized error handling)
      expect(output).toContain('Decisions');
    });

    it('should return JSON format when requested', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        topic: 'prisma',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      // Should match constraints.mustUse and decisions
      expect(parsed.constraints || parsed.decisions || parsed.stack).toBeDefined();
    });

    it('should return empty results for non-matching topic', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        topic: 'xyznonexistent',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(Object.keys(parsed)).toHaveLength(0);
    });
  });

  describe('scope-based queries', () => {
    it('should filter architecture directories by scope', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        scope: 'src/api',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(parsed.architecture).toBeDefined();
      const dirs = parsed.architecture.directories;
      expect(dirs.some((d: { path: string }) => d.path.startsWith('src/api'))).toBe(true);
    });

    it('should include entry points within scope', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        scope: 'src/api',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(parsed.architecture.entryPoints).toBeDefined();
      expect(parsed.architecture.entryPoints[0].file).toContain('src/api');
    });

    it('should still return all constraints (they apply globally)', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        scope: 'src/api',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(parsed.constraints).toBeDefined();
      expect(parsed.constraints.mustUse).toBeDefined();
    });
  });

  describe('type-based queries', () => {
    it('should return only constraints when --type constraints', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        type: 'constraints',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(parsed.constraints).toBeDefined();
      expect(parsed.project).toBeUndefined();
      expect(parsed.stack).toBeUndefined();
      expect(parsed.architecture).toBeUndefined();
      expect(parsed.decisions).toBeUndefined();
    });

    it('should return only stack when --type stack', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        type: 'stack',
        format: 'md',
      });

      expect(output).toContain('Stack');
      expect(output).toContain('TypeScript');
      expect(output).not.toContain('## Architecture');
      expect(output).not.toContain('## Constraints');
    });
  });

  describe('combined filters', () => {
    it('should combine topic + type filter', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        topic: 'error',
        type: 'decisions',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(parsed.decisions).toBeDefined();
      expect(parsed.architecture).toBeUndefined();
    });

    it('should combine topic + scope', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        topic: 'middleware',
        scope: 'src/api',
        format: 'md',
      });

      expect(output).toContain('middleware');
    });
  });

  describe('token budget', () => {
    it('should truncate output when exceeding token budget', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        type: 'architecture',
        format: 'md',
        maxTokens: 20,
      });

      expect(output).toContain('truncated to fit token budget');
    });

    it('should not truncate when within budget', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        type: 'stack',
        format: 'md',
        maxTokens: 5000,
      });

      expect(output).not.toContain('truncated');
    });

    it('should report token estimate', async () => {
      const { tokenEstimate } = await executeQuery(TEST_DIR, {
        type: 'stack',
        format: 'md',
      });

      expect(tokenEstimate).toBeGreaterThan(0);
    });
  });

  describe('output format', () => {
    it('should produce valid JSON output', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        type: 'project',
        format: 'json',
      });

      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should produce markdown with headers', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        type: 'architecture',
        format: 'md',
      });

      expect(output).toContain('# Prelude Query Results');
      expect(output).toContain('## Architecture');
    });

    it('should strip $schema and version from JSON output', async () => {
      const { output } = await executeQuery(TEST_DIR, {
        type: 'stack',
        format: 'json',
      });

      const parsed = JSON.parse(output);
      expect(parsed.stack.$schema).toBeUndefined();
      expect(parsed.stack.version).toBeUndefined();
      expect(parsed.stack.language).toBe('TypeScript');
    });
  });
});

describe('exportCompact', () => {
  it('should return flat string with bracketed section prefixes', async () => {
    const { output } = await exportCompact(TEST_DIR, {});

    expect(output).toContain('[stack]');
    expect(output).toContain('[arch]');
    expect(output).toContain('[constraints]');
    expect(output).toContain('[project]');
    expect(output).toContain('[decisions]');
  });

  it('should NOT contain markdown headers, bold markers, or emoji', async () => {
    const { output } = await exportCompact(TEST_DIR, {});

    // No markdown headers
    expect(output).not.toMatch(/^#{1,3}\s/m);
    // No bold markers
    expect(output).not.toContain('**');
    // No emoji (common unicode emoji ranges)
    expect(output).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    // No horizontal rule separators
    expect(output).not.toContain('---');
  });

  it('should respect topic filtering', async () => {
    const { output } = await exportCompact(TEST_DIR, { topic: 'error' });

    // Should have some output since fixtures contain "error handling" references
    expect(output.length).toBeGreaterThan(0);
    // Should not include stack section (no error-related content there)
    expect(output).not.toContain('[stack]');
  });

  it('should respect scope filtering for architecture directories', async () => {
    const { output } = await exportCompact(TEST_DIR, { scope: 'src/api' });

    // Architecture section should be present but filtered
    expect(output).toContain('[arch]');
    // Should contain src/api directories
    expect(output).toContain('src/api');
    // Should not contain unrelated directories like src/models
    expect(output).not.toContain('src/models');
  });

  it('should respect maxTokens budget', async () => {
    const { output } = await exportCompact(TEST_DIR, { maxTokens: 10 });

    expect(output).toContain('[... truncated to fit token budget]');
  });

  it('should return tokenEstimate > 0', async () => {
    const { tokenEstimate } = await exportCompact(TEST_DIR, {});

    expect(tokenEstimate).toBeGreaterThan(0);
  });

  it('should return empty string for non-matching topic', async () => {
    const { output, tokenEstimate } = await exportCompact(TEST_DIR, {
      topic: 'xyznonexistent',
    });

    expect(output).toBe('');
    expect(tokenEstimate).toBe(0);
  });
});

describe('exportCompact session history', () => {
  it('should include [history] line when session.json exists', async () => {
    const sessionData = {
      sessions: [{
        sessionId: 'test',
        startedAt: '2026-01-01T00:00:00Z',
        entries: [
          {
            id: 'run-1',
            timestamp: '2026-01-01T00:00:00Z',
            type: 'prompt',
            summary: 'Add error handling to API',
            filesAffected: ['src/api/index.ts'],
            outcome: 'failed',
            tags: ['evolution']
          },
          {
            id: 'run-2',
            timestamp: '2026-01-02T00:00:00Z',
            type: 'prompt',
            summary: 'Add error handling to API',
            filesAffected: ['src/api/index.ts'],
            outcome: 'success',
            tags: ['evolution']
          }
        ]
      }]
    };
    await writeFile(join(CONTEXT_DIR, 'session.json'), JSON.stringify(sessionData));

    const { output } = await exportCompact(TEST_DIR, {});
    expect(output).toContain('[history]');
    expect(output).toContain('failed');
    expect(output).toContain('success');
  });

  it('should filter history by topic', async () => {
    const sessionData = {
      sessions: [{
        sessionId: 'test',
        startedAt: '2026-01-01T00:00:00Z',
        entries: [
          {
            id: 'run-1',
            timestamp: '2026-01-01T00:00:00Z',
            type: 'prompt',
            summary: 'Add error handling to API',
            filesAffected: ['src/api/index.ts'],
            outcome: 'failed',
            tags: []
          },
          {
            id: 'run-2',
            timestamp: '2026-01-02T00:00:00Z',
            type: 'prompt',
            summary: 'Update database migrations',
            filesAffected: ['src/models/db.ts'],
            outcome: 'success',
            tags: []
          }
        ]
      }]
    };
    await writeFile(join(CONTEXT_DIR, 'session.json'), JSON.stringify(sessionData));

    const { output } = await exportCompact(TEST_DIR, { topic: 'error' });
    expect(output).toContain('[history]');
    expect(output).toContain('error handling');
    expect(output).not.toContain('database migrations');
  });

  it('should not include [history] when no session.json exists', async () => {
    const { output } = await exportCompact(TEST_DIR, {});
    expect(output).not.toContain('[history]');
  });
});
