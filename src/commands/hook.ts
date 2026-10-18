import type { CAC } from 'cac';
import { resolve } from 'path';
import { logger } from '../utils/log.js';
import { installHook, uninstallHook } from '../core/git-hook.js';

const MESSAGES = {
  created: 'Created pre-commit hook',
  added: 'Added drift check to existing pre-commit hook',
  updated: 'Updated drift check in pre-commit hook',
  unchanged: 'Pre-commit hook already checks for drift',
  removed: 'Removed drift check from pre-commit hook',
  absent: 'No prelude drift check found in pre-commit hook',
} as const;

export function registerHookCommand(cli: CAC) {
  cli
    .command('hook <action> [dir]', 'Install or uninstall a git pre-commit hook that runs `prelude diff --check`')
    .action(async (action: string, dir: string | undefined) => {
      const rootDir = resolve(dir || process.cwd());
      if (action !== 'install' && action !== 'uninstall') {
        logger.error(`Unknown action "${action}". Use \`prelude hook install\` or \`prelude hook uninstall\`.`);
        process.exit(1);
      }
      try {
        const result = action === 'install' ? await installHook(rootDir) : await uninstallHook(rootDir);
        logger.success(`${MESSAGES[result.action]}: ${result.path}`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
