import { join, resolve } from 'path';
import { homedir } from 'os';

/**
 * The user-level Prelude home: $PRELUDE_HOME, else ~/.prelude.
 * Never created on read; writers create it lazily.
 */
export function resolvePreludeHome(): string {
  const override = process.env.PRELUDE_HOME;
  return override ? resolve(override) : join(homedir(), '.prelude');
}

export function workspaceFilePath(): string {
  return join(resolvePreludeHome(), 'workspace.json');
}

export function workspaceIndexPath(): string {
  return join(resolvePreludeHome(), 'index.json');
}
