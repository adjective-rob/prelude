import type { CAC } from 'cac';
import { join } from 'path';
import { readJSON, writeJSON, fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { getCurrentTimestamp, generateId } from '../utils/time.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';
import type { Decision, Decisions } from '../schema/index.js';

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
        status?: 'proposed' | 'accepted' | 'rejected' | 'deprecated' | 'superseded';
        author?: string;
        tags?: string;
      },
      dir: string = process.cwd()
    ) => {
      const rootDir = dir;
      const contextDir = join(rootDir, CONTEXT_DIR);
      const decisionsPath = join(contextDir, CONTEXT_FILES.DECISIONS);
      
      // Check if .context exists
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }
      
      logger.decision(`Recording decision: ${title}`);
      
      // Read existing decisions
      let decisions: Decisions = { decisions: [] };
      if (await fileExists(decisionsPath)) {
        decisions = await readJSON<Decisions>(decisionsPath);
      }
      
      // Prompt for rationale if not provided
      let rationale = options.rationale;
      if (!rationale) {
        logger.warn('No rationale provided. Please provide a brief explanation:');
        // In a real implementation, you'd use a prompt library like enquirer
        // For now, we'll require it via the flag
        logger.error('Please provide --rationale flag');
        process.exit(1);
      }
      
      // Parse alternatives and tags
      const alternatives = options.alternatives ? options.alternatives.split(',').map(s => s.trim()) : undefined;
      const tags = options.tags ? options.tags.split(',').map(s => s.trim()) : undefined;
      
      // Create new decision
      const decision: Decision = {
        id: generateId(),
        timestamp: getCurrentTimestamp(),
        title,
        status: options.status || 'accepted',
        rationale,
        alternatives,
        impact: options.impact,
        author: options.author,
        tags
      };
      
      // Add to decisions
      decisions.decisions.push(decision);
      
      // Write back
      await writeJSON(decisionsPath, decisions);
      
      logger.success('✓ Decision recorded successfully!');
      logger.info(`\nDecision ID: ${decision.id}`);
      logger.info(`Status: ${decision.status}`);
      if (alternatives) {
        logger.info(`Alternatives considered: ${alternatives.length}`);
      }
    });
}