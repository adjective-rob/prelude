import type { CAC } from 'cac';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { copyToClipboard } from '../utils/clipboard.js';
import { platform } from 'os';
import { fileExists } from '../utils/fs.js';
import { logger, spinner } from '../utils/log.js';
import { CONTEXT_FILES } from '../constants.js';
import { resolveContextDir } from '../runtime/context.js';

export function registerShareCommand(cli: CAC) {
  cli
    .command('share [dir]', 'Quick copy context to clipboard (with preview)')
    .option('--format <format>', 'Output format (md or json)', { default: 'md' })
    .action(async (dir: string = process.cwd(), options: { 
      format: 'md' | 'json';
    }) => {
      const rootDir = dir;
      const contextDir = resolveContextDir(rootDir);
      
      // Check if .context exists
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }
      
      // Determine which file to read
      const format = options.format === 'json' ? 'json' : 'md';
      const filename = format === 'json' ? CONTEXT_FILES.EXPORT_JSON : CONTEXT_FILES.EXPORT_MD;
      const exportPath = join(contextDir, filename);
      
      // Check if export exists, if not generate it
      if (!(await fileExists(exportPath))) {
        logger.info('Generating export...');
        const { saveExport } = await import('../core/exporter.js');
        await saveExport(rootDir, format);
      }
      
      try {
        const content = await readFile(exportPath, 'utf-8');
        
        // Copy to clipboard
        const spin = spinner('Copying to clipboard...');
        const copied = await copyToClipboard(content);
        spin.stop();
        
        if (copied) {
          logger.success('Context copied to clipboard!');
          logger.info('Ready to paste into your AI chat\n');
          
          // Show preview
          const lines = content.split('\n');
          const preview = lines.slice(0, 5).join('\n');
          console.log('Preview:');
          console.log('─'.repeat(50));
          console.log(preview);
          if (lines.length > 5) {
            console.log('...');
          }
          console.log('─'.repeat(50));
          console.log(`\n${lines.length} lines | ${content.length} characters`);
        } else {
          const os = platform();
          logger.warn('Clipboard tool not found');
          
          if (os === 'linux') {
            logger.info('\nInstall xclip or xsel:');
            logger.info('  sudo apt install xclip');
            logger.info('  # or');
            logger.info('  sudo apt install xsel');
          }
          
          logger.info('\nManual copy:');
          logger.info(`  cat ${exportPath}`);
        }
        
      } catch (error) {
        logger.error(`Failed to read export: ${error}`);
        process.exit(1);
      }
    });
}