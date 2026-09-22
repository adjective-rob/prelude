import type { CAC } from 'cac';
import { resolve } from 'path';
import { logger } from '../utils/log.js';
import { loadLocateContext, locateInMap, formatLocateText } from '../core/locate.js';

export function registerLocateCommand(cli: CAC) {
  cli
    .command('locate <...query>', 'Find the files most likely relevant to a task phrase')
    .option('--limit <n>', 'Maximum number of files to return', { default: '8' })
    .option('--scope <dir>', 'Only consider files under this directory')
    .option('--tests', 'Include test files (default: only when the query mentions tests)')
    .option('--format <format>', 'Output format: text or json', { default: 'text' })
    .option('--root <path>', 'Project root directory (default: cwd)')
    .action(async (
      queryWords: string[],
      options: { limit: string; scope?: string; tests?: boolean; format: string; root?: string }
    ) => {
      const rootDir = resolve(options.root || process.cwd());
      const query = queryWords.join(' ');
      const limit = parseInt(options.limit, 10);

      let ctx;
      try {
        ctx = await loadLocateContext(rootDir);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      const hits = locateInMap(ctx.map, query, {
        limit: Number.isFinite(limit) && limit > 0 ? limit : 8,
        scope: options.scope,
        includeTests: options.tests ? true : undefined,
      }, { decisions: ctx.decisions, architecture: ctx.architecture });

      if (options.format === 'json') {
        console.log(JSON.stringify(hits, null, 2));
      } else {
        process.stdout.write(formatLocateText(hits, query, ctx.map));
      }
    });
}
