import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { inferArchitecture } from '../src/core/infer.js';

const roots: string[] = [];

async function fixture(pkg: Record<string, unknown>, dirs: string[]): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prelude-arch-type-'));
  roots.push(rootDir);
  await writeFile(join(rootDir, 'package.json'), JSON.stringify(pkg));
  for (const dir of dirs) {
    await mkdir(join(rootDir, dir), { recursive: true });
    await writeFile(join(rootDir, dir, 'index.ts'), 'export const x = 1;\n');
  }
  return rootDir;
}

afterAll(async () => {
  await Promise.all(roots.map(r => rm(r, { recursive: true, force: true })));
});

describe('architecture type for Node packages', () => {
  it('classifies a published package with a pages/ directory as a library', async () => {
    const rootDir = await fixture(
      { name: 'webfw', version: '1.0.0', main: 'dist/index.js', types: 'dist/index.d.ts', exports: { '.': './dist/index.js' } },
      ['src', 'src/jsx', 'src/pages']
    );
    expect((await inferArchitecture(rootDir)).type).toBe('library');
  });

  it('keeps a private app with a pages/ directory as frontend', async () => {
    const rootDir = await fixture({ name: 'site', version: '1.0.0', private: true, main: 'index.js' }, ['src', 'src/pages']);
    expect((await inferArchitecture(rootDir)).type).toBe('frontend');
  });

  it('does not call a package with a bin a library', async () => {
    const rootDir = await fixture(
      { name: 'tool', version: '1.0.0', bin: { tool: 'dist/cli.js' }, exports: { '.': './dist/index.js' } },
      ['src', 'bin']
    );
    expect((await inferArchitecture(rootDir)).type).toBe('cli');
  });
});
