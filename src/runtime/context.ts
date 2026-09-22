import { join, resolve, basename } from 'path';
import { CONTEXT_DIR } from '../constants.js';

/**
 * Resolve where a project's context lives.
 * Embedded mode (default): <rootDir>/.context
 * External brain mode (PRELUDE_ROOT set): <PRELUDE_ROOT>/<project basename>
 */
export function resolveContextDir(rootDir: string): string {
  const externalRoot = process.env.PRELUDE_ROOT;
  const absRoot = resolve(rootDir);
  if (externalRoot) {
    return join(resolve(externalRoot), basename(absRoot));
  }
  return join(absRoot, CONTEXT_DIR);
}

export function isExternalBrainMode(): boolean {
  return Boolean(process.env.PRELUDE_ROOT);
}
