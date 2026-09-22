import { stat } from 'fs/promises';
import { basename, resolve, join } from 'path';
import { resolveContextDir } from '../runtime/context.js';
import { workspaceFilePath, workspaceIndexPath } from '../runtime/home.js';
import { fileExists } from '../utils/fs.js';
import { CONTEXT_FILES } from '../constants.js';
import {
  loadWorkspace,
  findProject,
  loadWorkspaceIndex,
  refreshWorkspaceIndex,
} from '../core/workspace.js';
import type { WorkspaceIndex } from '../schema/index.js';

export interface ResolvedProject {
  name: string;
  rootDir: string;
  contextDir: string;
}

export interface ProjectResolver {
  mode: 'single' | 'workspace';
  resolve(project?: string): Promise<ResolvedProject>;
  list(): Promise<ResolvedProject[]>;
}

export function singleProjectResolver(rootDir: string): ProjectResolver {
  const abs = resolve(rootDir);
  const project: ResolvedProject = { name: basename(abs), rootDir: abs, contextDir: resolveContextDir(abs) };
  return {
    mode: 'single',
    resolve: async () => project,
    list: async () => [project],
  };
}

/**
 * Resolves projects from the user-level workspace. The workspace file is
 * re-read on every call so `prelude workspace add` in another terminal is
 * visible without restarting the server.
 */
export function workspaceResolver(): ProjectResolver {
  const toResolved = (p: { name: string; path: string }): ResolvedProject => ({
    name: p.name,
    rootDir: p.path,
    contextDir: resolveContextDir(p.path),
  });

  return {
    mode: 'workspace',
    async resolve(project?: string) {
      const ws = await loadWorkspace();
      const names = ws.projects.map(p => p.alias ?? p.name).join(', ');
      if (ws.projects.length === 0) {
        throw new Error('No projects registered. Run `prelude workspace add <path>`.');
      }
      let entry;
      if (project === undefined || project.trim() === '') {
        if (ws.projects.length !== 1) throw new Error(`Specify project. Registered: ${names}`);
        entry = ws.projects[0];
      } else {
        entry = findProject(ws, project);
        if (!entry) throw new Error(`Unknown project "${project}". Registered: ${names}`);
      }
      const resolved = toResolved(entry);
      if (!(await fileExists(entry.path)) || !(await fileExists(resolved.contextDir))) {
        throw new Error(`Project ${entry.name} path no longer exists: ${entry.path}`);
      }
      return resolved;
    },
    async list() {
      const ws = await loadWorkspace();
      const out: ResolvedProject[] = [];
      for (const p of ws.projects) {
        const r = toResolved(p);
        if ((await fileExists(p.path)) && (await fileExists(r.contextDir))) out.push(r);
      }
      return out;
    },
  };
}

async function mtime(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Load the workspace index, rebuilding it when forced, missing, older than
 * the workspace file, or older than any project's context files.
 */
export async function ensureFreshIndex(force = false): Promise<WorkspaceIndex> {
  if (!force) {
    const index = await loadWorkspaceIndex();
    const indexTime = await mtime(workspaceIndexPath());
    if (index && indexTime >= (await mtime(workspaceFilePath()))) {
      let stale = false;
      for (const p of index.projects) {
        for (const file of [CONTEXT_FILES.PROJECT, CONTEXT_FILES.MAP, CONTEXT_FILES.ARCHITECTURE, CONTEXT_FILES.DECISIONS]) {
          if ((await mtime(join(p.contextDir, file))) > indexTime) {
            stale = true;
            break;
          }
        }
        if (stale) break;
      }
      if (!stale) return index;
    }
  }
  return refreshWorkspaceIndex();
}
