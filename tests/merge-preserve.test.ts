import { describe, it, expect } from 'vitest';
import { ContextMerger } from '../src/core/merger.js';
import { StateManager } from '../src/core/state-manager.js';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ContextMerger — preserve existing fields', () => {
  let tempDir: string;
  let merger: ContextMerger;

  // Create a temp .context dir with state manager
  const setup = async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prelude-merge-'));
    const contextDir = join(tempDir, '.context');
    await mkdir(contextDir, { recursive: true });
    const stateManager = new StateManager(contextDir);
    merger = new ContextMerger(stateManager);
  };

  const cleanup = async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  };

  describe('mergeStack', () => {
    it('preserves existing dependencies when inference returns none', async () => {
      await setup();
      try {
        const existing = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          packageManager: 'pip',
          runtime: 'Python >=3.11',
          dependencies: { litellm: '>=1.0', pydantic: '>=2.0' },
          devDependencies: { pytest: '>=7.0', ruff: '>=0.3.0' },
          frameworks: ['Typer'],
          framework: 'Typer',
          testingFrameworks: ['pytest'],
        };

        // Simulate inference that only detects language + packageManager
        const inferred = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          packageManager: 'poetry',
        };

        const result = merger.mergeStack(existing as any, inferred as any);

        // Inferred fields should win
        expect(result.merged.packageManager).toBe('poetry');
        // Existing fields should be preserved
        expect(result.merged.dependencies).toEqual({ litellm: '>=1.0', pydantic: '>=2.0' });
        expect(result.merged.devDependencies).toEqual({ pytest: '>=7.0', ruff: '>=0.3.0' });
        expect(result.merged.runtime).toBe('Python >=3.11');
        expect(result.merged.frameworks).toEqual(['Typer']);
        expect((result.merged as any).framework).toBe('Typer');
        expect(result.merged.testingFrameworks).toEqual(['pytest']);
      } finally {
        await cleanup();
      }
    });

    it('inferred non-empty values overwrite existing', async () => {
      await setup();
      try {
        const existing = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          runtime: 'Python >=3.10',
          dependencies: { old: '1.0' },
        };

        const inferred = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          runtime: 'Python >=3.11',
          dependencies: { new: '2.0' },
        };

        const result = merger.mergeStack(existing as any, inferred as any);

        // Inferred values should win when they have content
        expect(result.merged.runtime).toBe('Python >=3.11');
        expect(result.merged.dependencies).toEqual({ new: '2.0' });
      } finally {
        await cleanup();
      }
    });

    it('preserves existing non-empty object over inferred empty object', async () => {
      await setup();
      try {
        const existing = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          dependencies: { litellm: '>=1.0' },
        };

        const inferred = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          dependencies: {},
        };

        const result = merger.mergeStack(existing as any, inferred as any);

        // Existing deps should be preserved over empty inferred
        expect(result.merged.dependencies).toEqual({ litellm: '>=1.0' });
      } finally {
        await cleanup();
      }
    });

    it('preserves existing non-empty array over inferred empty array', async () => {
      await setup();
      try {
        const existing = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          frameworks: ['Typer', 'Next.js'],
        };

        const inferred = {
          $schema: 'https://adjective.us/prelude/schemas/v1/stack.schema.json',
          version: '1.0.0',
          language: 'Python',
          frameworks: [],
        };

        const result = merger.mergeStack(existing as any, inferred as any);

        expect(result.merged.frameworks).toEqual(['Typer', 'Next.js']);
      } finally {
        await cleanup();
      }
    });
  });

  describe('mergeConstraints', () => {
    it('preserves existing codeStyle when inference returns empty', async () => {
      await setup();
      try {
        const existing = {
          $schema: 'https://adjective.us/prelude/schemas/v1/constraints.schema.json',
          version: '1.0.0',
          mustUse: ['Python 3.11+'],
          mustNotUse: ['Do not rewrite files from scratch'],
          codeStyle: { linter: 'Ruff' },
          testing: { required: true, strategy: 'pytest' },
        };

        const inferred = {
          $schema: 'https://adjective.us/prelude/schemas/v1/constraints.schema.json',
          version: '1.0.0',
          mustUse: [],
          mustNotUse: [],
        };

        const result = merger.mergeConstraints(existing as any, inferred as any);

        // Existing rich fields should be preserved
        expect((result.merged as any).codeStyle).toEqual({ linter: 'Ruff' });
        expect((result.merged as any).testing).toEqual({ required: true, strategy: 'pytest' });
        // Existing non-empty arrays should be preserved over empty inferred
        expect(result.merged.mustUse).toEqual(['Python 3.11+']);
        expect(result.merged.mustNotUse).toEqual(['Do not rewrite files from scratch']);
      } finally {
        await cleanup();
      }
    });
  });
});
