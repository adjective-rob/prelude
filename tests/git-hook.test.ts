import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'fs/promises';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { installHook, uninstallHook } from '../src/core/git-hook.js';
import { fileExists } from '../src/utils/fs.js';

describe('git pre-commit hook', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  });

  async function repo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-hook-'));
    dirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
  }

  const hookPath = (dir: string) => join(dir, '.git', 'hooks', 'pre-commit');

  it('creates an executable hook, and re-running leaves it unchanged', async () => {
    const dir = await repo();
    expect((await installHook(dir)).action).toBe('created');
    const content = await readFile(hookPath(dir), 'utf-8');
    expect(content.startsWith('#!/bin/sh\n# >>> prelude >>>')).toBe(true);
    expect(content).toContain('  prelude diff --check ||');
    expect((await stat(hookPath(dir))).mode & 0o111).not.toBe(0);
    expect((await installHook(dir)).action).toBe('unchanged');
  });

  it('puts the block after the shebang of an existing hook and removes only the block', async () => {
    const dir = await repo();
    await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
    const original = '#!/bin/bash\nnpm run lint\nexit 0\n';
    await writeFile(hookPath(dir), original);

    expect((await installHook(dir)).action).toBe('added');
    const content = await readFile(hookPath(dir), 'utf-8');
    expect(content.indexOf('prelude diff --check')).toBeLessThan(content.indexOf('exit 0'));
    expect(content.startsWith('#!/bin/bash\n')).toBe(true);

    expect((await uninstallHook(dir)).action).toBe('removed');
    expect(await readFile(hookPath(dir), 'utf-8')).toBe(original);
  });

  it('deletes a hook it created when uninstalled', async () => {
    const dir = await repo();
    await installHook(dir);
    await uninstallHook(dir);
    expect(await fileExists(hookPath(dir))).toBe(false);
    expect((await uninstallHook(dir)).action).toBe('absent');
  });

  it('changes into a project that lives in a subdirectory', async () => {
    const dir = await repo();
    const sub = join(dir, "packages", "it's");
    await mkdir(sub, { recursive: true });
    await installHook(sub);
    expect(await readFile(hookPath(dir), 'utf-8')).toContain(`(cd 'packages/it'\\''s' && prelude diff --check)`);
  });

  it('refuses to edit a hook that is not a shell script', async () => {
    const dir = await repo();
    await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
    await writeFile(hookPath(dir), '#!/usr/bin/env node\nconsole.log(1);\n');
    await expect(installHook(dir)).rejects.toThrow(/not a shell script/);
  });

  it('writes to .husky/pre-commit under husky', async () => {
    const dir = await repo();
    await mkdir(join(dir, '.husky', '_'), { recursive: true });
    execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: dir });
    const result = await installHook(dir);
    expect(result.path).toBe(join(dir, '.husky', 'pre-commit'));
    expect((await readFile(result.path, 'utf-8')).startsWith('# >>> prelude >>>')).toBe(true);
  });

  it('fails outside a git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-nogit-'));
    dirs.push(dir);
    await expect(installHook(dir)).rejects.toThrow(/Not inside a git repository/);
  });
});
