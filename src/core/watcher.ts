import chokidar from 'chokidar';
import { join } from 'path';
import { writeJSON, readJSON, fileExists } from '../utils/fs.js';
import { getCurrentTimestamp } from '../utils/time.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';
import { updateContext } from './updater.js';

export interface WatchEvent {
  timestamp: string;
  type: 'add' | 'change' | 'unlink';
  path: string;
  contextUpdated: string[];
}

export interface WatcherOptions {
  once?: boolean;
  verbose?: boolean;
  ignore?: string[];
}

export function createWatcher(
  rootDir: string, 
  onChange: (files: string[], events: WatchEvent[]) => void,
  options: WatcherOptions = {}
) {
  const patterns = [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'tsconfig.json',
    'tailwind.config.js',
    'tailwind.config.ts',
    '.eslintrc.json',
    '.eslintrc.js',
    'eslint.config.js',
    '.prettierrc',
    '.prettierrc.json',
    'prettier.config.js',
    'src/**/*',
    'lib/**/*',
    'app/**/*',
    'pages/**/*',
    'components/**/*',
    'requirements.txt',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod'
  ];
  
  const defaultIgnore = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.context/**',
    '**/*.test.*',
    '**/*.spec.*'
  ];
  
  const watcher = chokidar.watch(patterns, {
    cwd: rootDir,
    ignored: [...defaultIgnore, ...(options.ignore || [])],
    persistent: !options.once,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });
  
  const changedFiles: Set<string> = new Set();
  const events: WatchEvent[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;
  
  const handleChange = async (path: string, eventType: 'add' | 'change' | 'unlink') => {
    changedFiles.add(path);
    
    const event: WatchEvent = {
      timestamp: getCurrentTimestamp(),
      type: eventType,
      path,
      contextUpdated: []
    };
    
    events.push(event);
    
    // Debounce updates to avoid rapid-fire changes
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    debounceTimer = setTimeout(async () => {
      const files = Array.from(changedFiles);
      const result = await updateContext(rootDir, files);
      
      // Update the last event with what was actually updated
      if (events.length > 0) {
        events[events.length - 1].contextUpdated = result.updated;
      }
      
      // Log to watchlog.json
      await logWatchEvents(rootDir, events);
      
      // Call the callback
      onChange(files, events);
      
      // Reset
      changedFiles.clear();
      events.length = 0;
      
      if (options.once) {
        await watcher.close();
      }
    }, 1000);
  };
  
  watcher
    .on('add', path => handleChange(path, 'add'))
    .on('change', path => handleChange(path, 'change'))
    .on('unlink', path => handleChange(path, 'unlink'))
    .on('error', error => console.error('Watcher error:', error));
  
  return watcher;
}

async function logWatchEvents(rootDir: string, events: WatchEvent[]) {
  const watchlogPath = join(rootDir, CONTEXT_DIR, CONTEXT_FILES.WATCHLOG);
  
  let existingLogs: WatchEvent[] = [];
  if (await fileExists(watchlogPath)) {
    try {
      const data = await readJSON<{ events: WatchEvent[] }>(watchlogPath);
      existingLogs = data.events || [];
    } catch {
      // If file is corrupted, start fresh
    }
  }
  
  // Keep only the last 100 events
  const allEvents = [...existingLogs, ...events].slice(-100);
  
  await writeJSON(watchlogPath, { events: allEvents });
}

export async function watchOnce(rootDir: string): Promise<void> {
  return new Promise((resolve) => {
    const watcher = createWatcher(
      rootDir,
      () => {
        watcher.close();
        resolve();
      },
      { once: true }
    );
  });
}