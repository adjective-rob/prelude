import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseGitignore, loadGitignore } from '../src/utils/gitignore.js';
import { buildMap } from '../src/core/map-scanner.js';
import { inferArchitecture } from '../src/core/infer.js';

describe('parseGitignore', () => {
  it('ignores nothing for an empty file or only comments', () => {
    expect(parseGitignore('')('src/a.ts', false)).toBe(false);
    expect(parseGitignore('# note\n\n')('src/a.ts', false)).toBe(false);
  });

  it('matches a bare name at any depth', () => {
    const ig = parseGitignore('generated\n*.gen.ts\n');
    expect(ig('generated', true)).toBe(true);
    expect(ig('src/generated', true)).toBe(true);
    expect(ig('src/api/client.gen.ts', false)).toBe(true);
    expect(ig('src/api/client.ts', false)).toBe(false);
  });

  it('anchors patterns that contain a slash', () => {
    const ig = parseGitignore('/vendor\nsrc/tmp\n');
    expect(ig('vendor', true)).toBe(true);
    expect(ig('lib/vendor', true)).toBe(false);
    expect(ig('src/tmp', true)).toBe(true);
    expect(ig('packages/a/src/tmp', true)).toBe(false);
  });

  it('applies directory-only patterns to directories only', () => {
    const ig = parseGitignore('out/\n');
    expect(ig('out', true)).toBe(true);
    expect(ig('src/out', false)).toBe(false);
  });

  it('supports ** and ?', () => {
    const ig = parseGitignore('**/fixtures/**\ndocs/**/draft-?.ts\n');
    expect(ig('tests/fixtures/a.ts', false)).toBe(true);
    expect(ig('docs/x/y/draft-1.ts', false)).toBe(true);
    expect(ig('docs/x/y/draft-10.ts', false)).toBe(false);
  });

  it('lets a later negation win', () => {
    const ig = parseGitignore('*.gen.ts\n!keep.gen.ts\n');
    expect(ig('src/a.gen.ts', false)).toBe(true);
    expect(ig('src/keep.gen.ts', false)).toBe(false);
  });

  it('skips patterns it cannot parse instead of throwing', () => {
    expect(() => parseGitignore('[unclosed\n(\n')('src/a.ts', false)).not.toThrow();
  });
});

describe('gitignore-aware scanning', () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'prelude-gitignore-'));
    await writeFile(join(rootDir, 'package.json'), JSON.stringify({ name: 'gi-fixture', version: '1.0.0' }));
    await writeFile(join(rootDir, '.gitignore'), 'generated/\n*.gen.ts\n');
    await mkdir(join(rootDir, 'src', 'generated'), { recursive: true });
    await mkdir(join(rootDir, 'scratch'), { recursive: true });
    await writeFile(join(rootDir, 'src', 'index.ts'), 'export const a = 1;\n');
    await writeFile(join(rootDir, 'src', 'client.gen.ts'), 'export const gen = 1;\n');
    await writeFile(join(rootDir, 'src', 'generated', 'types.ts'), 'export type T = string;\n');
    await writeFile(join(rootDir, 'scratch', 'notes.ts'), 'export const n = 1;\n');
  });

  afterAll(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('returns a no-op matcher when there is no .gitignore', async () => {
    const ig = await loadGitignore(join(rootDir, 'src'));
    expect(ig('anything', true)).toBe(false);
  });

  it('keeps ignored files and directories out of the map', async () => {
    const files = (await buildMap(rootDir)).modules.flatMap(m => m.files.map(f => f.file));
    expect(files).toEqual(['scratch/notes.ts', 'src/index.ts']);
  });

  it('keeps ignored directories out of architecture.json', async () => {
    const dirs = ((await inferArchitecture(rootDir)).directories ?? []).map((d: { path: string }) => d.path);
    expect(dirs).toContain('src');
    expect(dirs).not.toContain('src/generated');
  });
});
