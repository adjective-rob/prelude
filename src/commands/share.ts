import type { CAC } from 'cac';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { spawn, execSync } from 'child_process';
import { platform } from 'os';
import { fileExists } from '../utils/fs.js';
import { logger, spinner } from '../utils/log.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';

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

export function registerShareCommand(cli: CAC) {
  cli
    .command('share [dir]', 'Quick copy context to clipboard (with preview)')
    .option('--format <format>', 'Output format (md or json)', { default: 'md' })
    .action(async (dir: string = process.cwd(), options: { 
      format: 'md' | 'json';
    }) => {
      const rootDir = dir;
      const contextDir = join(rootDir, CONTEXT_DIR);
      
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
          logger.success('✓ Context copied to clipboard!');
          logger.info('📋 Ready to paste into your AI chat\n');
          
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
        
      } catch (error) {
        logger.error(`Failed to read export: ${error}`);
        process.exit(1);
      }
    });
}