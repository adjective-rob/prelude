import type { CAC } from 'cac';
import { resolve } from 'path';
import { fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { resolveContextDir } from '../runtime/context.js';
import { listHistory, formatHistoryLine } from '../core/history.js';
import { MAX_HISTORY } from '../core/state-manager.js';

export function registerHistoryCommand(cli: CAC) {
  cli
    .command('history [dir]', 'Show what recent `prelude update` runs changed')
    .option('--limit <n>', 'Number of updates to show', { default: MAX_HISTORY })
    .option('--format <format>', 'Output format: text or json', { default: 'text' })
    .action(async (dir: string | undefined, options: { limit: number; format: string }) => {
      const contextDir = resolveContextDir(resolve(dir || process.cwd()));
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }

      const entries = (await listHistory(contextDir)).slice(0, Math.max(1, Number(options.limit) || MAX_HISTORY));
      if (options.format === 'json') {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log('No update history yet. Each `prelude update` that changes something records an entry.');
        return;
      }
      for (const entry of entries) console.log(formatHistoryLine(entry));
    });
}
