import type { CAC } from 'cac';
import { resolve } from 'path';
import { fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { resolveContextDir } from '../runtime/context.js';
import { computeDiff, formatChanges, type ContextChange } from '../core/diff.js';

export interface DiffJson {
  changed: boolean;
  count: number;
  changes: ContextChange[];
}

export function formatDiffJson(changes: ContextChange[]): DiffJson {
  return { changed: changes.length > 0, count: changes.length, changes };
}

export function formatDiffSummary(drift: ContextChange[]): string {
  return drift.length === 0
    ? 'Context is up to date.'
    : `Context has drifted: ${drift.length} change${drift.length === 1 ? '' : 's'}. Run \`prelude update\`.`;
}

export function registerDiffCommand(cli: CAC) {
  cli
    .command('diff [dir]', 'Show what `prelude update` would change, without writing')
    .option('--check', 'Exit 1 when the committed context has drifted from the code')
    .option('--format <format>', 'Output format: text or json', { default: 'text' })
    .option('--all', 'Include preserved (informational) changes')
    .action(async (dir: string | undefined, options: { check?: boolean; format: string; all?: boolean }) => {
      const rootDir = resolve(dir || process.cwd());
      if (!(await fileExists(resolveContextDir(rootDir)))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }

      let result;
      try {
        result = await computeDiff(rootDir);
      } catch (error) {
        logger.error(`Diff failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }

      const shown = options.all ? result.changes : result.drift;
      if (options.format === 'json') {
        console.log(JSON.stringify(formatDiffJson(shown), null, 2));
      } else {
        if (shown.length > 0) {
          process.stdout.write(formatChanges(shown, { color: Boolean(process.stdout.isTTY) }) + '\n');
        }
        console.log(formatDiffSummary(result.drift));
      }

      if (options.check && result.drift.length > 0) process.exit(1);
    });
}
