import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { inferArchitecture } from '../src/core/infer.js';
import { isTestFile } from '../src/core/source-scanner.js';

describe('Node CLI entry points', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  });

  it('maps package.json bin in dist back to source and finds shebang bin files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-bin-'));
    dirs.push(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', bin: { x: 'dist/bin/x.js' } }));
    await mkdir(join(dir, 'bin'), { recursive: true });
    await writeFile(join(dir, 'bin', 'x.ts'), '#!/usr/bin/env node\nconsole.log(1);\n');
    await writeFile(join(dir, 'bin', 'helper.ts'), 'export const y = 1;\n');
    await writeFile(join(dir, 'bin', 'other.js'), '#!/usr/bin/env node\n');

    const arch = await inferArchitecture(dir);
    expect(arch.entryPoints).toEqual([
      { file: 'bin/x.ts', purpose: 'CLI entry point' },
      { file: 'bin/other.js', purpose: 'CLI entry point' },
    ]);
  });
});

describe('isTestFile', () => {
  it('recognises test directories and test file names', () => {
    expect(isTestFile('tests/context-dir.test.ts')).toBe(true);
    expect(isTestFile('src/a.spec.tsx')).toBe(true);
    expect(isTestFile('app/test_billing.py')).toBe(true);
    expect(isTestFile('pkg/api/handler_test.go')).toBe(true);
    expect(isTestFile('src/core/merger.ts')).toBe(false);
    expect(isTestFile('src/testing/utils.ts')).toBe(false);
  });
});
