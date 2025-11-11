import type { CAC } from 'cac';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { spawn, execSync } from 'child_process';
import { platform } from 'os';
import { fileExists } from '../utils/fs.js';
import { logger, spinner } from '../utils/log.js';
import { CONTEXT_DIR } from '../constants.js';
import { saveExport } from '../core/exporter.js';

// Check if a command exists
function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Native clipboard using shell commands (no dependencies!)
async function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const os = platform();
      let command: string;
      let args: string[] = [];
      
      if (os === 'darwin') {
        command = 'pbcopy';
      } else if (os === 'linux') {
        // Check which clipboard tool is available
        if (commandExists('xclip')) {
          command = 'xclip';
          args = ['-selection', 'clipboard'];
        } else if (commandExists('xsel')) {
          command = 'xsel';
          args = ['--clipboard', '--input'];
        } else {
          resolve(false);
          return;
        }
      } else if (os === 'win32') {
        command = 'clip.exe';
      } else {
        resolve(false);
        return;
      }
      
      const proc = spawn(command, args);
      let errorOccurred = false;
      
      proc.on('error', () => {
        errorOccurred = true;
        resolve(false);
      });
      
      // For clipboard commands, if stdin closes without error, assume success
      proc.stdin.on('finish', () => {
        if (!errorOccurred) {
          // Give it a tiny moment to process, then assume success
          setTimeout(() => resolve(true), 100);
        }
      });
      
      proc.stdin.write(text);
      proc.stdin.end();
      
    } catch {
      resolve(false);
    }
  });
}

export function registerExportCommand(cli: CAC) {
  cli
    .command('export [dir]', 'Generate LLM-optimized export')
    .option('--format <format>', 'Output format (md or json)', { default: 'md' })
    .option('--no-copy', 'Skip copying to clipboard')
    .option('--print', 'Print to stdout after export')
    .action(async (dir: string = process.cwd(), options: { 
      format: 'md' | 'json';
      copy?: boolean;
      print?: boolean;
    }) => {
      const rootDir = dir;
      const contextDir = join(rootDir, CONTEXT_DIR);
      
      // Check if .context exists
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }
      
      logger.export('Exporting context...');
      
      const format = options.format === 'json' ? 'json' : 'md';
      const spin = spinner(`Generating ${format.toUpperCase()} export...`);
      
      try {
        const exportPath = await saveExport(rootDir, format);
        spin.stop();
        
        logger.success(`✓ Export generated: ${exportPath}`);
        
        // Read the exported content
        const content = await readFile(exportPath, 'utf-8');
        
        // Auto-copy to clipboard by default (unless --no-copy is specified)
        const shouldCopy = options.copy !== false;
        
        if (shouldCopy) {
          const copySpin = spinner('Copying to clipboard...');
          const copied = await copyToClipboard(content);
          copySpin.stop();
          
          if (copied) {
            logger.success('✓ Copied to clipboard!');
            logger.info('📋 Ready to paste into your AI chat');
          } else {
            const os = platform();
            logger.warn('⚠ Clipboard tool not found');
            
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