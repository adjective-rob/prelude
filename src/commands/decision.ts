import type { CAC } from 'cac';
import { fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { resolveContextDir } from '../runtime/context.js';
import { addDecision } from '../core/decisions.js';
import type { Decision } from '../schema/index.js';

export function registerDecisionCommand(cli: CAC) {
  cli
    .command('decision <title>', 'Log an architectural decision')
    .option('--rationale <text>', 'Decision rationale')
    .option('--alternatives <items>', 'Comma-separated list of alternatives considered')
    .option('--impact <text>', 'Impact of the decision')
    .option('--status <status>', 'Decision status (proposed, accepted, rejected)', { default: 'accepted' })
    .option('--author <name>', 'Decision author')
    .option('--tags <items>', 'Comma-separated tags')
    .action(async (
      title: string,
      options: {
        rationale?: string;
        alternatives?: string;
        impact?: string;
        status?: Decision['status'];
        author?: string;
        tags?: string;
      }
    ) => {
      const contextDir = resolveContextDir(process.cwd());

      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }

      if (!options.rationale) {
        logger.error('Please provide --rationale flag');
        process.exit(1);
      }

      logger.decision(`Recording decision: ${title}`);

      const split = (value?: string) => value ? value.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const decision = await addDecision(contextDir, {
        title,
        rationale: options.rationale,
        alternatives: split(options.alternatives),
        impact: options.impact,
        status: options.status,
        author: options.author,
        tags: split(options.tags),
      });

      logger.success('✓ Decision recorded successfully!');
      logger.info(`\nDecision ID: ${decision.id}`);
      logger.info(`Status: ${decision.status}`);
      if (decision.alternatives) {
        logger.info(`Alternatives considered: ${decision.alternatives.length}`);
      }
    });
}
