import type { CAC } from 'cac';
import { readFile } from 'fs/promises';
import { copyToClipboard } from '../utils/clipboard.js';
import { platform } from 'os';
import { fileExists } from '../utils/fs.js';
import { logger, spinner } from '../utils/log.js';
import { saveExport, type ExportFormat } from '../core/exporter.js';
import { resolveContextDir } from '../runtime/context.js';

export function registerExportCommand(cli: CAC) {
  cli
    .command('export [dir]', 'Generate LLM-optimized export')
    .option('--format <format>', 'Output format: md, json, claude-md, agents-md, cursorrules', { default: 'md' })
    .option('--no-copy', 'Skip copying to clipboard')
    .option('--print', 'Print to stdout after export')
    .action(async (dir: string = process.cwd(), options: {
      format: string;
      copy?: boolean;
      print?: boolean;
    }) => {
    const rootDir = dir;

    const contextDir = resolveContextDir(rootDir);

      // Check if .context exists
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }

      logger.export('Exporting context...');

      const validFormats = ['md', 'json', 'claude-md', 'agents-md', 'cursorrules'];
      const format = validFormats.includes(options.format) ? options.format : 'md';
      const formatLabel = format === 'claude-md' ? 'CLAUDE.md' : format === 'agents-md' ? 'AGENTS.md' : format === 'cursorrules' ? '.cursorrules' : format.toUpperCase();
      const spin = spinner(`Generating ${formatLabel} export...`);
      
      try {
        const exportPath = await saveExport(rootDir, format as ExportFormat);
        spin.stop();
        
        logger.success(`Export generated: ${exportPath}`);
        
        // Read the exported content
        const content = await readFile(exportPath, 'utf-8');
        
        // Auto-copy to clipboard by default (unless --no-copy is specified)
        const shouldCopy = options.copy !== false;
        
        if (shouldCopy) {
          const copySpin = spinner('Copying to clipboard...');
          const copied = await copyToClipboard(content);
          copySpin.stop();
          
          if (copied) {
            logger.success('Copied to clipboard!');
            logger.info('Ready to paste into your AI chat');
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
        }
        
        // Handle --print flag
        if (options.print) {
          console.log('\n' + '─'.repeat(50));
          console.log(content);
          console.log('─'.repeat(50) + '\n');
        }
        
      } catch (error) {
        spin.stop();
        logger.error(`Failed to generate export: ${error}`);
        process.exit(1);
      }
    });
}