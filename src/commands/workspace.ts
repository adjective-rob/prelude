import type { CAC } from 'cac';
import { stat } from 'fs/promises';
import { logger } from '../utils/log.js';
import { resolvePreludeHome, workspaceFilePath, workspaceIndexPath } from '../runtime/home.js';
import {
  addProject,
  removeProject,
  loadWorkspace,
  loadWorkspaceIndex,
  refreshWorkspaceIndex,
  isInWorkspace,
} from '../core/workspace.js';
import type { IndexedProject } from '../schema/index.js';

function tildify(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
}

export function formatProjectListLine(p: IndexedProject): string {
  const label = p.alias ? `${p.name} (${p.alias})` : p.name;
  if (p.missing) return `${label}  ${tildify(p.path)}  · MISSING`;
  const parts = [p.type, p.language].filter(Boolean) as string[];
  if (p.modules?.length) parts.push(`${p.modules.length} modules`);
  if (p.hubs?.length) parts.push(`${p.hubs.length} hubs`);
  const endpoints = p.apiEndpointCount ?? p.apiEndpoints?.length ?? 0;
  if (endpoints > 0) parts.push(`${endpoints} endpoints`);
  if (!p.hasMap) parts.push('no map (run prelude update)');
  return `${label}  ${tildify(p.path)}${parts.length ? '  · ' + parts.join(' · ') : ''}`;
}

/** Hint printed after init/update when the project is not registered. */
export async function printWorkspaceHint(rootDir: string): Promise<void> {
  try {
    if (!(await isInWorkspace(rootDir))) {
      logger.info('Tip: prelude workspace add . — makes this project available to prelude serve --workspace');
    }
  } catch {
    // never let the hint fail a command
  }
}

async function workspaceAdd(path: string | undefined, alias?: string): Promise<void> {
  if (!path) throw new Error('Usage: prelude workspace add <path> [--alias <name>]');
  const entry = await addProject(path, alias);
  const index = await refreshWorkspaceIndex();
  const indexed = index.projects.find(p => p.path === entry.path);
  logger.success(`✓ Registered ${indexed ? formatProjectListLine(indexed) : entry.name}`);
  logger.info('Serve it: prelude serve --workspace');
}

async function workspaceRemove(key: string | undefined): Promise<void> {
  if (!key) throw new Error('Usage: prelude workspace remove <name|alias|path>');
  if (!(await removeProject(key))) {
    throw new Error(`No registered project matches "${key}". Run \`prelude workspace list\`.`);
  }
  await refreshWorkspaceIndex();
  logger.success(`✓ Removed ${key}`);
}

async function workspaceList(): Promise<void> {
  const ws = await loadWorkspace();
  if (ws.projects.length === 0) {
    console.log('No projects registered. Run `prelude workspace add <path>`.');
    return;
  }
  let index = await loadWorkspaceIndex();
  if (!index || index.projects.length !== ws.projects.length) index = await refreshWorkspaceIndex();
  for (const p of index.projects) console.log(formatProjectListLine(p));
}

async function workspaceIndex(): Promise<void> {
  const index = await refreshWorkspaceIndex();
  const missing = index.projects.filter(p => p.missing).length;
  const mapped = index.projects.filter(p => p.hasMap).length;
  logger.success(`✓ Indexed ${index.projects.length} project(s): ${mapped} with a map${missing ? `, ${missing} missing` : ''}`);
  logger.info(`Index: ${workspaceIndexPath()}`);
}

async function workspaceStatus(): Promise<void> {
  const ws = await loadWorkspace();
  console.log(`Home:      ${resolvePreludeHome()}`);
  console.log(`Workspace: ${workspaceFilePath()}`);
  console.log(`Index:     ${workspaceIndexPath()}`);
  console.log(`Projects:  ${ws.projects.length}`);
  try {
    const info = await stat(workspaceIndexPath());
    const minutes = Math.round((Date.now() - info.mtimeMs) / 60000);
    console.log(`Index age: ${minutes < 1 ? 'just now' : `${minutes} min`}`);
  } catch {
    console.log('Index age: not built (run `prelude workspace index`)');
  }
}

const ACTIONS = ['add', 'remove', 'list', 'index', 'status'] as const;

export function registerWorkspaceCommands(cli: CAC) {
  // cac matches commands on the first word only, so subcommands dispatch here
  cli
    .command('workspace <action> [target]', 'Manage the user-level workspace: add <path>, remove <name>, list, index, status')
    .option('--alias <name>', 'Short name for the project in agent tools (with add)')
    .example('prelude workspace add . --alias backend')
    .example('prelude workspace list')
    .action(async (action: string, target: string | undefined, options: { alias?: string }) => {
      try {
        switch (action) {
          case 'add': return await workspaceAdd(target, options.alias);
          case 'remove': return await workspaceRemove(target);
          case 'list': return await workspaceList();
          case 'index': return await workspaceIndex();
          case 'status': return await workspaceStatus();
          default:
            throw new Error(`Unknown workspace action "${action}". Use one of: ${ACTIONS.join(', ')}`);
        }
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
