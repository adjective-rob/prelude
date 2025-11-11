import { readFile, writeFile, mkdir, access, readdir, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { constants } from 'fs';

export async function readJSON<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

export async function writeJSON(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function readMarkdown(path: string): Promise<string> {
  return await readFile(path, 'utf-8');
}

export async function writeMarkdown(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function getDirectoryTree(rootDir: string, maxDepth: number = 2, currentDepth: number = 0): Promise<string[]> {
  if (currentDepth >= maxDepth) return [];
  
  const dirs: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const fullPath = join(rootDir, entry.name);
      dirs.push(fullPath);
      
      const subDirs = await getDirectoryTree(fullPath, maxDepth, currentDepth + 1);
      dirs.push(...subDirs);
    }
  }
  
  return dirs;
}