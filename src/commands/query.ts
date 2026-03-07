import type { CAC } from 'cac';
import { join } from 'path';
import { fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { CONTEXT_DIR } from '../constants.js';
import { executeQuery, VALID_TYPES } from '../core/query-engine.js';
import type { ContextType } from '../core/query-engine.js';

export function registerQueryCommand(cli: CAC) {
  cli
    .command('query [topic]', 'Query project context by topic, scope, or type')
    .option('--scope <path>', 'Filter results to a specific directory scope')
    .option('--type <type>', 'Filter by context type (project, stack, architecture, constraints, decisions)')
    .option('--format <format>', 'Output format (md or json)', { default: 'md' })
    .option('--max-tokens <n>', 'Limit output to approximate token budget')
    .action(async (
      topic: string | undefined,
      options: {
        scope?: string;
        type?: string;
        format: string;
        maxTokens?: string;
      }
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

      // Validate --type
      if (options.type && !VALID_TYPES.includes(options.type as ContextType)) {
        logger.error(`Invalid type: "${options.type}". Valid types: ${VALID_TYPES.join(', ')}`);
        process.exit(1);
      }

      // Must provide at least one filter
      if (!topic && !options.scope && !options.type) {
        logger.error('Provide a topic, --scope, or --type to query. Run `prelude query --help` for usage.');
        process.exit(1);
      }

      const format = options.format === 'json' ? 'json' : 'md';
      const maxTokens = options.maxTokens ? parseInt(options.maxTokens, 10) : undefined;

      if (maxTokens !== undefined && (isNaN(maxTokens) || maxTokens <= 0)) {
        logger.error('--max-tokens must be a positive number.');
        process.exit(1);
      }

      try {
        const { output, tokenEstimate } = await executeQuery(rootDir, {
          topic,
          scope: options.scope,
          type: options.type as ContextType | undefined,
          format,
          maxTokens,
        });

        // Print results to stdout (machine-friendly, no decoration)
        console.log(output);

        // Print token estimate to stderr so it doesn't pollute piped output
        const budgetNote = maxTokens ? ` (budget: ${maxTokens})` : '';
        process.stderr.write(`\n~${tokenEstimate} tokens${budgetNote}\n`);
      } catch (error) {
        logger.error(`Query failed: ${error}`);
        process.exit(1);
      }
    });
}
