import { readFile } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { readJSON, writeJSON, fileExists } from '../utils/fs.js';
import { CONTEXT_FILES } from '../constants.js';
import { resolveContextDir } from '../runtime/context.js';
import { workspaceFilePath, workspaceIndexPath } from '../runtime/home.js';
import { parsePyprojectToml, extractPyDepName } from './infer.js';
import type {
  Workspace,
  WorkspaceProject,
  WorkspaceIndex,
  IndexedProject,
  Project,
  Stack,
  Architecture,
  CodeMap,
  Decisions,
  RelatedProject,
} from '../schema/index.js';

/**
 * Workspace: a user-level registry of projects (~/.prelude/workspace.json)
 * and a generated index over their context (~/.prelude/index.json). This is
 * what lets one MCP server answer questions about every registered codebase.
 */

const SCHEMA_URL = 'https://adjective.us/prelude/schemas/v1';
const WORKSPACE_VERSION = '1.0.0';
const MAX_INDEXED_ENDPOINTS = 40;
const MAX_INDEXED_HUBS = 5;

function emptyWorkspace(): Workspace {
  return { $schema: `${SCHEMA_URL}/workspace.schema.json`, version: WORKSPACE_VERSION, projects: [] };
}

async function readJSONSafe<T>(path: string): Promise<T | undefined> {
  try {
    return await readJSON<T>(path);
  } catch {
    return undefined;
  }
}

export async function loadWorkspace(): Promise<Workspace> {
  const ws = await readJSONSafe<Workspace>(workspaceFilePath());
  if (!ws || !Array.isArray(ws.projects)) return emptyWorkspace();
  return ws;
}

export async function saveWorkspace(ws: Workspace): Promise<void> {
  const sorted = { ...ws, projects: [...ws.projects].sort((a, b) => a.name.localeCompare(b.name)) };
  await writeJSON(workspaceFilePath(), sorted);
}

/** Match alias, then name, then basename(path), then exact path; case-insensitive. */
export function findProject(ws: Workspace, key: string): WorkspaceProject | undefined {
  const k = key.trim().toLowerCase();
  if (!k) return undefined;
  const absKey = resolve(key).toLowerCase();
  return (
    ws.projects.find(p => p.alias?.toLowerCase() === k) ??
    ws.projects.find(p => p.name.toLowerCase() === k) ??
    ws.projects.find(p => basename(p.path).toLowerCase() === k) ??
    ws.projects.find(p => p.path.toLowerCase() === k || p.path.toLowerCase() === absKey)
  );
}

export async function addProject(path: string, alias?: string): Promise<WorkspaceProject> {
  const absPath = resolve(path);
  const contextDir = resolveContextDir(absPath);
  if (!(await fileExists(contextDir))) {
    throw new Error(`No context found at ${contextDir}. Run \`prelude init\` in that project first.`);
  }

  const project = await readJSONSafe<Project>(join(contextDir, CONTEXT_FILES.PROJECT));
  const name = project?.name?.trim() || basename(absPath);

  const ws = await loadWorkspace();
  const existing = ws.projects.find(p => p.path === absPath);
  if (existing) {
    existing.name = name;
    if (alias !== undefined) existing.alias = alias;
    await saveWorkspace(ws);
    return existing;
  }

  const clash = ws.projects.find(p =>
    p.name.toLowerCase() === name.toLowerCase() || (p.alias && p.alias.toLowerCase() === (alias ?? name).toLowerCase())
  );
  if (clash && !alias) {
    throw new Error(
      `A project named "${name}" is already registered at ${clash.path}. ` +
      `Pass --alias <short-name> to register this one under a different name.`
    );
  }
  if (alias && ws.projects.some(p => p.alias?.toLowerCase() === alias.toLowerCase() || p.name.toLowerCase() === alias.toLowerCase())) {
    throw new Error(`The alias "${alias}" is already in use. Choose another.`);
  }

  const entry: WorkspaceProject = { name, path: absPath, ...(alias ? { alias } : {}), addedAt: new Date().toISOString() };
  ws.projects.push(entry);
  await saveWorkspace(ws);
  return entry;
}

export async function removeProject(nameOrPathOrAlias: string): Promise<boolean> {
  const ws = await loadWorkspace();
  const target = findProject(ws, nameOrPathOrAlias);
  if (!target) return false;
  ws.projects = ws.projects.filter(p => p !== target);
  await saveWorkspace(ws);
  return true;
}

// --- Manifests ---

interface Manifest {
  packageName?: string;
  dependencies: Set<string>;
}

function normalizePackageName(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, '-');
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

/** Package name and dependency names from whichever manifests exist. */
export async function readManifest(projectPath: string): Promise<Manifest> {
  const deps = new Set<string>();
  let packageName: string | undefined;

  try {
    const pkg = await readJSONSafe<Record<string, any>>(join(projectPath, 'package.json'));
    if (pkg) {
      if (typeof pkg.name === 'string') packageName ??= pkg.name;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(pkg[field] ?? {})) deps.add(normalizePackageName(dep));
      }
    }
  } catch { /* best-effort */ }

  try {
    const raw = await readText(join(projectPath, 'pyproject.toml'));
    if (raw) {
      const py = parsePyprojectToml(raw);
      const name = py.project?.name ?? py.tool?.poetry?.name;
      if (typeof name === 'string') packageName ??= name;
      for (const dep of (Array.isArray(py.project?.dependencies) ? py.project.dependencies : [])) {
        if (typeof dep === 'string') deps.add(normalizePackageName(extractPyDepName(dep)));
      }
      for (const dep of Object.keys(py.tool?.poetry?.dependencies ?? {})) {
        if (dep !== 'python') deps.add(normalizePackageName(dep));
      }
    }
    const reqs = await readText(join(projectPath, 'requirements.txt'));
    if (reqs) {
      for (const line of reqs.split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#') && !t.startsWith('-')) deps.add(normalizePackageName(extractPyDepName(t)));
      }
    }
  } catch { /* best-effort */ }

  try {
    const gomod = await readText(join(projectPath, 'go.mod'));
    if (gomod) {
      const mod = gomod.match(/^module\s+(\S+)/m)?.[1];
      if (mod) packageName ??= mod;
      for (const m of gomod.matchAll(/^\s*require\s+(\S+)\s+v/gm)) deps.add(m[1].toLowerCase());
      for (const block of gomod.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)) {
        for (const m of block[1].matchAll(/^\s*(\S+)\s+v\S+/gm)) deps.add(m[1].toLowerCase());
      }
    }
  } catch { /* best-effort */ }

  try {
    const cargo = await readText(join(projectPath, 'Cargo.toml'));
    if (cargo) {
      const parsed = parsePyprojectToml(cargo);
      if (typeof parsed.package?.name === 'string') packageName ??= parsed.package.name;
      for (const table of ['dependencies', 'dev-dependencies', 'build-dependencies']) {
        for (const dep of Object.keys(parsed[table] ?? {})) deps.add(normalizePackageName(dep));
      }
      // Dependencies declared as their own tables: [dependencies.foo]
      for (const m of cargo.matchAll(/^\[(?:dev-|build-)?dependencies\.([\w-]+)\]/gm)) deps.add(normalizePackageName(m[1]));
    }
  } catch { /* best-effort */ }

  return { packageName, dependencies: deps };
}

// --- Index ---

async function indexProject(entry: WorkspaceProject): Promise<{ indexed: IndexedProject; manifest: Manifest }> {
  const contextDir = resolveContextDir(entry.path);
  const base: IndexedProject = {
    name: entry.name,
    ...(entry.alias ? { alias: entry.alias } : {}),
    path: entry.path,
    contextDir,
    hasMap: false,
  };

  if (!(await fileExists(entry.path)) || !(await fileExists(contextDir))) {
    return { indexed: { ...base, missing: true }, manifest: { dependencies: new Set() } };
  }

  const [project, stack, architecture, map, decisions, manifest] = await Promise.all([
    readJSONSafe<Project>(join(contextDir, CONTEXT_FILES.PROJECT)),
    readJSONSafe<Stack>(join(contextDir, CONTEXT_FILES.STACK)),
    readJSONSafe<Architecture>(join(contextDir, CONTEXT_FILES.ARCHITECTURE)),
    readJSONSafe<CodeMap>(join(contextDir, CONTEXT_FILES.MAP)),
    readJSONSafe<Decisions>(join(contextDir, CONTEXT_FILES.DECISIONS)),
    readManifest(entry.path),
  ]);

  const indexed: IndexedProject = { ...base };
  if (project?.description && project.description !== 'No description provided') indexed.description = project.description;
  if (architecture?.type) indexed.type = architecture.type;
  if (stack?.language) indexed.language = stack.language;
  if (stack?.frameworks?.length) indexed.frameworks = stack.frameworks;
  if (manifest.packageName) indexed.packageName = manifest.packageName;
  if (architecture?.entryPoints?.length) {
    indexed.entryPoints = architecture.entryPoints.map(e => ({ file: e.file, purpose: e.purpose }));
  }
  const endpoints = architecture?.apiEndpoints ?? [];
  if (endpoints.length > 0) {
    indexed.apiEndpoints = endpoints.slice(0, MAX_INDEXED_ENDPOINTS).map(e => ({ path: e.path, methods: e.methods, file: e.file }));
    indexed.apiEndpointCount = endpoints.length;
  }
  if (map && Array.isArray(map.modules)) {
    indexed.hasMap = true;
    const hubs = (map.hubs ?? []).slice(0, MAX_INDEXED_HUBS).map(h => ({ file: h.file, importedBy: h.importedBy }));
    if (hubs.length > 0) indexed.hubs = hubs;
    if (map.modules.length > 0) {
      indexed.modules = map.modules.map(m => ({ path: m.path, ...(m.purpose ? { purpose: m.purpose } : {}) }));
    }
  }
  if (project?.relatedProjects?.length) indexed.relatedProjects = [...project.relatedProjects];
  if (decisions?.decisions) indexed.decisionCount = decisions.decisions.length;
  if (project?.updatedAt) indexed.lastContextUpdate = project.updatedAt;

  return { indexed, manifest };
}

export async function buildWorkspaceIndex(ws?: Workspace): Promise<WorkspaceIndex> {
  const workspace = ws ?? (await loadWorkspace());
  const entries = await Promise.all(workspace.projects.map(indexProject));

  // Infer shares-package relations: A depends on B's package name
  for (const a of entries) {
    if (a.indexed.missing) continue;
    const inferred: RelatedProject[] = [];
    for (const b of entries) {
      if (a === b || b.indexed.missing || !b.manifest.packageName) continue;
      const bPkg = b.manifest.packageName;
      if (!a.manifest.dependencies.has(normalizePackageName(bPkg)) && !a.manifest.dependencies.has(bPkg.toLowerCase())) continue;
      const bNames = [b.indexed.name, b.indexed.alias].filter(Boolean).map(n => n!.toLowerCase());
      const listed = (a.indexed.relatedProjects ?? []).some(r => bNames.includes(r.name.toLowerCase()));
      if (!listed) inferred.push({ name: b.indexed.name, relation: 'shares-package' });
    }
    if (inferred.length > 0) {
      a.indexed.relatedProjects = [...(a.indexed.relatedProjects ?? []), ...inferred];
    }
  }

  return {
    $schema: `${SCHEMA_URL}/workspace-index.schema.json`,
    version: WORKSPACE_VERSION,
    generatedAt: new Date().toISOString(),
    projects: entries.map(e => e.indexed).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function saveWorkspaceIndex(index: WorkspaceIndex): Promise<void> {
  await writeJSON(workspaceIndexPath(), index);
}

export async function loadWorkspaceIndex(): Promise<WorkspaceIndex | undefined> {
  const index = await readJSONSafe<WorkspaceIndex>(workspaceIndexPath());
  return index && Array.isArray(index.projects) ? index : undefined;
}

/** Rebuild and save the index; returns it. */
export async function refreshWorkspaceIndex(): Promise<WorkspaceIndex> {
  const index = await buildWorkspaceIndex();
  await saveWorkspaceIndex(index);
  return index;
}

/** True when `rootDir` is registered in the workspace. */
export async function isInWorkspace(rootDir: string): Promise<boolean> {
  const ws = await loadWorkspace();
  const abs = resolve(rootDir);
  return ws.projects.some(p => p.path === abs);
}
