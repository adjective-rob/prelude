import { spawn, execFileSync } from 'child_process';
import { platform } from 'os';

// Check if a command exists
function commandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Native clipboard using shell commands (no dependencies!)
export async function copyToClipboard(text: string): Promise<boolean> {
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
