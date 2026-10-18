import { readFile, writeFile, chmod, unlink, mkdir } from 'fs/promises';
import { execFileSync } from 'child_process';
import { join, relative, resolve, sep } from 'path';
import { fileExists } from '../utils/fs.js';

const BEGIN = '# >>> prelude >>>';
const END = '# <<< prelude <<<';

export interface HookResult {
  path: string;
  action: 'created' | 'added' | 'updated' | 'removed' | 'unchanged' | 'absent';
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The pre-commit file to edit. Honours core.hooksPath; under husky
 * (core.hooksPath = .husky/_, whose files husky regenerates) it is
 * .husky/pre-commit instead.
 */
export function resolvePreCommitPath(rootDir: string): { hookPath: string; topLevel: string; husky: boolean } {
  let topLevel: string;
  let hooksDir: string;
  try {
    topLevel = git(rootDir, ['rev-parse', '--show-toplevel']);
    hooksDir = resolve(rootDir, git(rootDir, ['rev-parse', '--git-path', 'hooks']));
  } catch {
    throw new Error(`Not inside a git repository: ${rootDir}`);
  }
  if (hooksDir.endsWith(`${sep}.husky${sep}_`)) {
    return { hookPath: join(hooksDir, '..', 'pre-commit'), topLevel, husky: true };
  }
  return { hookPath: join(hooksDir, 'pre-commit'), topLevel, husky: false };
}

/** The marked block that fails a commit when .context/ has drifted. */
export function hookBlock(rootDir: string, topLevel: string): string {
  const rel = relative(topLevel, resolve(rootDir)).split(sep).join('/');
  const check = rel === '' ? 'prelude diff --check' : `(cd ${shellQuote(rel)} && prelude diff --check)`;
  return [
    BEGIN,
    '# Fail the commit when .context/ has drifted from the code. Skipped when',
    '# prelude is not installed. Remove with `prelude hook uninstall`.',
    'if command -v prelude >/dev/null 2>&1; then',
    `  ${check} || { echo "prelude: .context/ is out of date. Run \\\`prelude update\\\` and stage .context/." >&2; exit 1; }`,
    'fi',
    END,
  ].join('\n');
}

function stripBlock(content: string): string {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (start === -1 || end === -1 || end < start) return content;
  return content.slice(0, start) + content.slice(end + END.length).replace(/^\n/, '');
}

/**
 * Add the drift check to the pre-commit hook. A hook that already exists is
 * kept: the block goes right after its shebang so a trailing `exit 0` cannot
 * skip it. Re-running replaces the block in place.
 */
export async function installHook(rootDir: string): Promise<HookResult> {
  const { hookPath, topLevel, husky } = resolvePreCommitPath(rootDir);
  const block = hookBlock(rootDir, topLevel);

  if (!(await fileExists(hookPath))) {
    await mkdir(resolve(hookPath, '..'), { recursive: true });
    await writeFile(hookPath, husky ? `${block}\n` : `#!/bin/sh\n${block}\n`, 'utf-8');
    await chmod(hookPath, 0o755);
    return { path: hookPath, action: 'created' };
  }

  const existing = await readFile(hookPath, 'utf-8');
  if (existing.includes(BEGIN)) {
    const start = existing.indexOf(BEGIN);
    const end = existing.indexOf(END) + END.length;
    const next = existing.slice(0, start) + block + existing.slice(end);
    if (next === existing) return { path: hookPath, action: 'unchanged' };
    await writeFile(hookPath, next, 'utf-8');
    return { path: hookPath, action: 'updated' };
  }

  const firstLine = existing.split('\n', 1)[0];
  if (firstLine.startsWith('#!')) {
    if (!/\b(sh|bash|zsh|dash|ksh)\b/.test(firstLine)) {
      throw new Error(`${hookPath} is not a shell script (${firstLine}). Add \`prelude diff --check\` to it by hand.`);
    }
    await writeFile(hookPath, `${firstLine}\n${block}\n${existing.slice(firstLine.length + 1)}`, 'utf-8');
  } else {
    await writeFile(hookPath, `${block}\n${existing}`, 'utf-8');
  }
  return { path: hookPath, action: 'added' };
}

/** Remove the block. Deletes the hook when nothing but a shebang is left. */
export async function uninstallHook(rootDir: string): Promise<HookResult> {
  const { hookPath } = resolvePreCommitPath(rootDir);
  if (!(await fileExists(hookPath))) return { path: hookPath, action: 'absent' };
  const existing = await readFile(hookPath, 'utf-8');
  if (!existing.includes(BEGIN)) return { path: hookPath, action: 'absent' };

  const rest = stripBlock(existing);
  if (rest.replace(/^#!.*$/m, '').trim() === '') {
    await unlink(hookPath);
  } else {
    await writeFile(hookPath, rest, 'utf-8');
  }
  return { path: hookPath, action: 'removed' };
}
