import type { CAC } from 'cac';
import { join } from 'path';
import { fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { CONTEXT_DIR } from '../constants.js';
import { exportCompact } from '../core/compact.js';

export function registerCompactCommand(cli: CAC) {
  cli
    .command('compact [topic]', 'Export compact context for LLM prompt injection')
    .option('--scope <path>', 'Filter results to a specific directory scope')
    .option('--max-tokens <n>', 'Limit output to approximate token budget', { default: '800' })
    .action(async (
      topic: string | undefined,
      options: { scope?: string; maxTokens?: string }
    ) => {
      const rootDir = process.cwd();

      const externalRoot = process.env.PRELUDE_ROOT;
      const contextDir = externalRoot
        ? join(externalRoot, rootDir.split('/').pop() as string)
        : join(rootDir, CONTEXT_DIR);

      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }

      const maxTokens = parseInt(options.maxTokens!, 10);

      try {
        const output = await exportCompact(rootDir, {
          topic,
          scope: options.scope,
          maxTokens,
        });
        process.stdout.write(output);
        process.exit(0);
      } catch (error) {
        logger.error(`Compact export failed: ${error}`);
        process.exit(1);
      }
    });
}
