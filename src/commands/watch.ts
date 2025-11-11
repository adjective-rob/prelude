import type { CAC } from 'cac';
import { join } from 'path';
import { fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { CONTEXT_DIR } from '../constants.js';
import { createWatcher, watchOnce } from '../core/watcher.js';

export function registerWatchCommand(cli: CAC) {
  cli
    .command('watch [dir]', 'Watch for changes and update context')
    .option('--once', 'Update once and exit')
    .option('--verbose', 'Show detailed logging')
    .action(async (dir: string = process.cwd(), options: { once?: boolean; verbose?: boolean }) => {
      const rootDir = dir;
      const contextDir = join(rootDir, CONTEXT_DIR);
      
      // Check if .context exists
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }
      
      if (options.once) {
        logger.watch('Watching for changes (will exit after first update)...');
        await watchOnce(rootDir);
        logger.success('✓ Context updated');
        process.exit(0);
      }
      
      logger.watch('Watching for changes... (press Ctrl+C to stop)');
      logger.info('Monitoring: package.json, tsconfig.json, src/, lib/, app/\n');
      
      const watcher = createWatcher(
        rootDir,
        (files, events) => {
          logger.info(`\n📝 Detected ${files.length} change(s):`);
          
          if (options.verbose) {
            events.forEach(event => {
              logger.debug(`  ${event.type} → ${event.path}`);
              if (event.contextUpdated.length > 0) {
                logger.debug(`    Updated: ${event.contextUpdated.join(', ')}`);
              }
            });
          }
          
          // Get unique list of updated context files
          const updatedFiles = new Set<string>();
          events.forEach(event => {
            event.contextUpdated.forEach(file => updatedFiles.add(file));
          });
          
          if (updatedFiles.size > 0) {
            logger.success(`✓ Updated: ${Array.from(updatedFiles).join(', ')}`);
          } else {
            logger.info('No context updates needed');
          }
        },
        { verbose: options.verbose }
      );
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        logger.info('\n\nStopping watcher...');
        await watcher.close();
        logger.success('✓ Watcher stopped');
        process.exit(0);
      });
    });
}