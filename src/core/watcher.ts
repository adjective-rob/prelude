import chokidar from 'chokidar';
import type { Stats } from 'fs';
import { join, relative, isAbsolute, sep, basename } from 'path';
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
  // Top-level files worth watching (config + manifests + lockfiles).
  const rootFiles = new Set([
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
    'requirements.txt',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod'
  ]);

  // Directories whose contents we recurse into.
  const watchDirs = new Set(['src', 'lib', 'app', 'pages', 'components']);

  // Directories we never descend into.
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.context']);

  // chokidar 4 dropped glob support: `ignored` is now a predicate over paths.
  // We watch the project root recursively and prune everything that isn't a
  // watched root file or inside a watched source directory.
  const userIgnores = options.ignore || [];
  const isIgnored = (p: string, stats?: Stats): boolean => {
    const abs = isAbsolute(p) ? p : join(rootDir, p);
    const rel = relative(rootDir, abs);
    if (rel === '' || rel.startsWith('..')) return false; // the root itself

    const segments = rel.split(sep);
    if (segments.some(s => ignoreDirs.has(s))) return true;
    if (userIgnores.some(frag => rel.includes(frag))) return true;

    const isFile = stats?.isFile() ?? false;
    if (isFile && /\.(test|spec)\./.test(basename(abs))) return true;

    const top = segments[0];
    if (watchDirs.has(top)) return false; // descend into watched source trees

    if (segments.length === 1) {
      // Top-level entry: keep watched files, drop unlisted files/dirs.
      if (stats?.isDirectory()) return true;
      return !rootFiles.has(top);
    }

    // Anything deeper that isn't under a watched dir is noise.
    return true;
  };

  const watcher = chokidar.watch(rootDir, {
    ignored: isIgnored,
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
  
  const handleChange = async (rawPath: string, eventType: 'add' | 'change' | 'unlink') => {
    // chokidar emits absolute paths (we watch an absolute root); keep the
    // watchlog and callbacks relative to the project root as before.
    const path = isAbsolute(rawPath) ? relative(rootDir, rawPath) : rawPath;
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