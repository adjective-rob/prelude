import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Minimal .gitignore matcher for the project root's .gitignore.
 *
 * Supports comments, blank lines, negation (`!`), directory-only patterns
 * (trailing `/`), root anchoring (leading or inner `/`), `*`, `?`, `**`, and
 * character classes. Nested .gitignore files and global excludes are not
 * read. Best-effort: a missing or unreadable file ignores nothing.
 */

/** Returns true when `relPath` (forward slashes, relative to the root) is ignored. */
export type IgnoreFn = (relPath: string, isDir: boolean) => boolean;

interface Rule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRegExp(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        if (atStart && glob[i + 2] === '/') {
          out += '(?:.*/)?';   // "**/" — any number of leading directories
          i += 2;
        } else {
          out += '.*';         // "/**" or a bare "**"
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let body = glob.slice(i + 1, close).replace(/\\/g, '\\\\');
        if (body.startsWith('!')) body = '^' + body.slice(1);
        out += `[${body}]`;
        i = close;
      }
    } else {
      out += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  return out;
}

export function parseGitignore(content: string): IgnoreFn {
  const rules: Rule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;

    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\#') || line.startsWith('\\!')) {
      line = line.slice(1);
    }

    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;

    // A slash at the start or in the middle anchors the pattern to the root;
    // otherwise it matches a name at any depth.
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);

    try {
      const body = globToRegExp(line);
      rules.push({ re: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`), negate, dirOnly });
    } catch {
      // Unparseable pattern: skip it rather than fail the scan
    }
  }

  if (rules.length === 0) return () => false;

  return (relPath, isDir) => {
    const path = relPath.replace(/\\/g, '/');
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(path)) ignored = !rule.negate;
    }
    return ignored;
  };
}

/** Load the root .gitignore. Walkers prune ignored directories, so files beneath them are never visited. */
export async function loadGitignore(rootDir: string): Promise<IgnoreFn> {
  try {
    return parseGitignore(await readFile(join(rootDir, '.gitignore'), 'utf-8'));
  } catch {
    return () => false;
  }
}
