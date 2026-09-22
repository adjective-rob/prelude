import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { executeQuery, VALID_TYPES, truncateToTokenBudget, estimateTokens } from '../core/query-engine.js';
import { exportCompact } from '../core/compact.js';
import { loadLocateContext, locateInMap, formatLocateText, type LocateHit } from '../core/locate.js';
import { addDecision } from '../core/decisions.js';
import { annotateModule, formatModuleLine, normalizeModulePath } from '../core/map-annotate.js';
import { formatMapBody } from '../core/map-format.js';
import { StateManager } from '../core/state-manager.js';
import { fileExists, readJSON, writeJSON } from '../utils/fs.js';
import { getPackageVersion } from '../utils/version.js';
import { CONTEXT_FILES } from '../constants.js';
import { RELATION_TYPES } from '../schema/project.js';
import {
  singleProjectResolver,
  workspaceResolver,
  ensureFreshIndex,
  type ProjectResolver,
} from './resolver.js';
import { formatProjects } from './format-projects.js';
import type { ContextType } from '../core/query-engine.js';
import type { CodeMap, MapModule, Project, RelatedProject } from '../schema/index.js';

export type { ResolvedProject, ProjectResolver } from './resolver.js';

const SINGLE_INSTRUCTIONS =
  'Prelude serves committed context about this codebase. Recommended flow: ' +
  'call prelude_compact for an overview, prelude_locate to find the files for ' +
  'your task, then read those files. Record choices with ' +
  'prelude_record_decision and fix wrong module descriptions with ' +
  'prelude_annotate_module so the next session benefits.';

const WORKSPACE_INSTRUCTIONS =
  'Prelude serves committed context for several codebases on this machine. ' +
  'Start with prelude_projects to see what exists and how projects relate. ' +
  'Then prelude_compact(project) for an overview and prelude_locate(query, ' +
  'project) to find files before reading. Record choices with ' +
  'prelude_record_decision and cross-project contracts with ' +
  'prelude_link_projects.';

const PROJECT_PARAM_DESCRIPTION =
  'Project name or alias from prelude_projects. Required in workspace mode when more ' +
  'than one project is registered; ignored in single-project mode.';

export interface ServerOptions {
  rootDir?: string;      // single-project mode
  workspace?: boolean;   // workspace mode
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

function text(value: string, meta?: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text' as const, text: value }], ...(meta ? { _meta: meta } : {}) };
}

function errorResult(e: unknown): ToolResult {
  return {
    content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

async function loadMap(contextDir: string): Promise<CodeMap> {
  const mapPath = join(contextDir, CONTEXT_FILES.MAP);
  if (!(await fileExists(mapPath))) {
    throw new Error('map.json not found. Run `prelude update` to build it.');
  }
  return readJSON<CodeMap>(mapPath);
}

/** Overview: hubs plus one line per module. */
function formatMapOverview(map: CodeMap): string {
  let md = '';
  const hubs = (map.hubs ?? []).slice(0, 8);
  if (hubs.length > 0) {
    md += '**Read first:**\n';
    for (const h of hubs) md += `- \`${h.file}\` — imported by ${h.importedBy}\n`;
    md += '\n';
  }
  md += '**Modules:**\n';
  for (const mod of map.modules) {
    md += `- ${formatModuleLine(mod)}\n`;
  }
  return md;
}

function formatModuleDetail(map: CodeMap, mod: MapModule): string {
  const prefix = mod.path === '.' ? '' : mod.path + '/';
  const hubs = (map.hubs ?? []).filter(h => mod.path === '.' ? !h.file.includes('/') : h.file.startsWith(prefix));
  return formatMapBody({ ...map, modules: [mod], hubs });
}

function formatFileDetail(map: CodeMap, file: string): string {
  const target = normalizeModulePath(file);
  for (const mod of map.modules) {
    const f = mod.files.find(x => x.file === target);
    if (!f) continue;
    const importers = map.modules.flatMap(m => m.files).filter(x => x.imports?.includes(target)).map(x => x.file);
    let md = `### \`${f.file}\`\n`;
    md += `Module: \`${mod.path}\`${mod.purpose ? ` — ${mod.purpose}` : ''}\n`;
    md += `${f.lang} · ${f.lines} lines`;
    if (f.rank) md += ` · rank ${f.rank}`;
    if (f.isTest) md += ' · test';
    md += '\n';
    if (f.role) md += `Role: ${f.role}\n`;
    if (f.exports?.length) md += `Exports: ${f.exports.join(', ')}\n`;
    if (f.imports?.length) md += `Imports: ${f.imports.join(', ')}\n`;
    if (importers.length > 0) {
      const shown = importers.slice(0, 10).join(', ');
      md += `Imported by ${importers.length}: ${shown}${importers.length > 10 ? `, +${importers.length - 10}` : ''}\n`;
    }
    return md;
  }
  throw new Error(`File "${target}" is not in the map. Use prelude_locate to find files.`);
}

/** Locate across every project with a map; files are prefixed `<project>:`. */
async function locateAcrossProjects(
  resolver: ProjectResolver,
  query: string,
  opts: { limit: number; scope?: string; includeTests?: boolean }
): Promise<Array<LocateHit & { project: string }>> {
  const all: Array<LocateHit & { project: string }> = [];
  for (const p of await resolver.list()) {
    let ctx;
    try {
      ctx = await loadLocateContext(p.rootDir);
    } catch {
      continue; // no map in this project
    }
    const hits = locateInMap(ctx.map, query, opts, { decisions: ctx.decisions, architecture: ctx.architecture });
    for (const h of hits) all.push({ ...h, file: `${p.name}:${h.file}`, project: p.name });
  }
  all.sort((a, b) => b.score - a.score || (b.importedBy ?? 0) - (a.importedBy ?? 0) || (a.file < b.file ? -1 : 1));
  return all.slice(0, opts.limit);
}

export function createPreludeServer(options: ServerOptions | string): McpServer {
  const opts: ServerOptions = typeof options === 'string' ? { rootDir: options } : options;
  const resolver: ProjectResolver = opts.workspace
    ? workspaceResolver()
    : singleProjectResolver(opts.rootDir ?? process.cwd());
  const workspaceMode = resolver.mode === 'workspace';

  const server = new McpServer(
    { name: workspaceMode ? 'prelude' : 'prelude-context', version: getPackageVersion() },
    { instructions: workspaceMode ? WORKSPACE_INSTRUCTIONS : SINGLE_INSTRUCTIONS }
  );

  const project = z.string().optional().describe(PROJECT_PARAM_DESCRIPTION);

  server.tool(
    'prelude_query',
    'Query project context by topic, scope, or type. Returns structured context about the codebase.',
    {
      project,
      topic: z.string().optional().describe('Filter context by topic keyword (e.g. "database", "auth", "testing")'),
      scope: z.string().optional().describe('Filter to a specific directory path (e.g. "src/api", "packages/db")'),
      type: z.enum(VALID_TYPES as [ContextType, ...ContextType[]]).optional().describe('Return only a specific context type'),
      format: z.enum(['md', 'json']).default('md').describe('Output format — md for reading, json for parsing'),
      max_tokens: z.number().positive().optional().describe('Approximate token budget for the response'),
    },
    async ({ project, topic, scope, type, format, max_tokens }) => {
      if (!topic && !scope && !type) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Provide at least one filter — topic, scope, or type.' }],
          isError: true,
        };
      }
      try {
        const p = await resolver.resolve(project);
        const { output, tokenEstimate } = await executeQuery(p.rootDir, {
          topic,
          scope,
          type,
          format,
          maxTokens: max_tokens,
        });
        return text(output, { tokenEstimate });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_compact',
    'Get compact, token-efficient context for LLM prompt injection. Returns flat prefixed lines.',
    {
      project,
      topic: z.string().optional().describe('Filter context by topic keyword'),
      scope: z.string().optional().describe('Filter to a specific directory path'),
      max_tokens: z.number().positive().default(800).describe('Token budget (default 800)'),
    },
    async ({ project, topic, scope, max_tokens }) => {
      try {
        const p = await resolver.resolve(project);
        const output = await exportCompact(p.rootDir, { topic, scope, maxTokens: max_tokens });
        return text(output);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_status',
    'Check Prelude status — which context files exist and basic project info.',
    { project },
    async ({ project }) => {
      try {
        const p = await resolver.resolve(project);
        const fileNames = [
          CONTEXT_FILES.PROJECT,
          CONTEXT_FILES.STACK,
          CONTEXT_FILES.ARCHITECTURE,
          CONTEXT_FILES.CONSTRAINTS,
          CONTEXT_FILES.DECISIONS,
          CONTEXT_FILES.MAP,
        ];

        const existResults = await Promise.all(fileNames.map(f => fileExists(join(p.contextDir, f))));
        const files = fileNames.filter((_, i) => existResults[i]);

        let projectInfo: { name?: string; description?: string } | null = null;
        if (existResults[0]) {
          const data = await readJSON<{ name?: string; description?: string }>(join(p.contextDir, CONTEXT_FILES.PROJECT));
          projectInfo = { name: data.name, description: data.description };
        }

        const status = { contextDir: p.contextDir, files, project: projectInfo };
        return text(JSON.stringify(status, null, 2));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_locate',
    'Find the files most relevant to a task before reading or grepping. Give a short phrase describing what you need to change or understand (e.g. \'billing checkout webhook\', \'where manual edits are preserved\'). Returns ranked files with the reason each matched. Call this first when you do not already know which file to open.' +
      (workspaceMode ? ' Omit `project` to search every registered project; files are then prefixed with `<project>:`.' : ''),
    {
      project,
      query: z.string().describe('Short phrase describing what you need to find'),
      limit: z.number().int().positive().max(25).default(8).describe('Maximum files to return (default 8, max 25)'),
      scope: z.string().optional().describe('Only consider files under this directory'),
      include_tests: z.boolean().optional().describe('Include test files (default: only when the query mentions tests)'),
    },
    async ({ project, query, limit, scope, include_tests }) => {
      try {
        if (!query.trim()) throw new Error('Provide a non-empty query.');
        const locateOpts = { limit, scope, includeTests: include_tests };

        if (workspaceMode && !project) {
          const hits = await locateAcrossProjects(resolver, query, locateOpts);
          return text(formatLocateText(hits, query), { hits });
        }

        const p = await resolver.resolve(project);
        const ctx = await loadLocateContext(p.rootDir);
        const hits = locateInMap(ctx.map, query, locateOpts, {
          decisions: ctx.decisions,
          architecture: ctx.architecture,
        });
        return text(formatLocateText(hits, query, ctx.map), {
          hits: workspaceMode ? hits.map(h => ({ ...h, project: p.name })) : hits,
        });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_map',
    'Inspect the code map. With no arguments, returns the hub files to read first and a one-line summary of every module. With `module`, returns that module\'s purpose, notes, dependencies, tests, and files with exports. With `file`, returns that file\'s exports, resolved imports, importers count, and the module it belongs to.',
    {
      project,
      module: z.string().optional().describe('Module path, e.g. "src/core"'),
      file: z.string().optional().describe('File path relative to the project root'),
      max_tokens: z.number().positive().default(1200).describe('Approximate token budget (default 1200)'),
    },
    async ({ project, module, file, max_tokens }) => {
      try {
        const p = await resolver.resolve(project);
        const map = await loadMap(p.contextDir);
        let output: string;
        if (file) {
          output = formatFileDetail(map, file);
        } else if (module) {
          const path = normalizeModulePath(module);
          const mod = map.modules.find(m => m.path === path);
          if (!mod) {
            throw new Error(`Module "${path}" not found. Valid modules: ${map.modules.map(m => m.path).join(', ')}`);
          }
          output = formatModuleDetail(map, mod);
        } else {
          output = formatMapOverview(map);
        }
        const tokenEstimate = estimateTokens(output);
        if (tokenEstimate > max_tokens) output = truncateToTokenBudget(output, max_tokens);
        return text(output, { tokenEstimate });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_record_decision',
    'Record an architectural decision in .context/decisions.json so future sessions inherit it. Use this whenever you choose between approaches, adopt or reject a library, or establish a convention. Keep the title under 80 characters and put the reasoning in rationale.',
    {
      project,
      title: z.string().describe('Short title, under 80 characters'),
      rationale: z.string().describe('Why this was decided'),
      alternatives: z.array(z.string()).optional().describe('Alternatives considered'),
      impact: z.string().optional().describe('What this changes for the codebase'),
      tags: z.array(z.string()).optional().describe('Keywords, e.g. ["auth", "database"]'),
      status: z.enum(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']).default('accepted'),
      author: z.string().optional().describe('Who made the decision (default "agent")'),
    },
    async ({ project, title, rationale, alternatives, impact, tags, status, author }) => {
      try {
        const p = await resolver.resolve(project);
        const decision = await addDecision(p.contextDir, {
          title,
          rationale,
          alternatives,
          impact,
          tags,
          status,
          author: author ?? 'agent',
        });
        return text(JSON.stringify(decision, null, 2));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_annotate_module',
    'Correct or enrich what the map says about a module. Set `purpose` when the inferred purpose is wrong or missing; add `notes` for anything a future agent should know about this directory (gotchas, entry points, ownership). Manual purposes are never overwritten by prelude update.',
    {
      project,
      path: z.string().describe('Module path, e.g. "src/core"'),
      purpose: z.string().optional().describe('Short phrase describing what the module is for'),
      notes: z.string().optional().describe('Notes for future readers'),
    },
    async ({ project, path, purpose, notes }) => {
      try {
        if (!purpose && !notes) throw new Error('Provide purpose, notes, or both.');
        const p = await resolver.resolve(project);
        const mod = await annotateModule(p.contextDir, path, { purpose, notes });
        return text(formatModuleLine(mod));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  if (workspaceMode) {
    server.tool(
      'prelude_projects',
      'List every project registered in this workspace with its purpose, stack, entry points, API surface, hub files, and relationships to other projects. Call this first in any session that may touch more than one codebase, then use the returned name as the `project` argument on other tools.',
      {
        refresh: z.boolean().default(false).describe('Rebuild the workspace index first'),
      },
      async ({ refresh }) => {
        try {
          const index = await ensureFreshIndex(refresh);
          return text(formatProjects(index), { projectCount: index.projects.length });
        } catch (e) {
          return errorResult(e);
        }
      }
    );

    server.tool(
      'prelude_link_projects',
      'Record how two projects relate so future sessions know the contract between them. Writes to the `from` project\'s project.json. Example: from=frontend, to=backend, relation=consumes, contract=\'REST /api/v1 with Supabase JWT bearer; see backend CLAUDE.md for routes\'.',
      {
        from: z.string().describe('Project whose project.json records the relation'),
        to: z.string().describe('The related project'),
        relation: z.enum(RELATION_TYPES).describe('consumes: from calls to; provides: to calls from; shares-package: from imports to; sibling; other'),
        contract: z.string().optional().describe('The interface between them, e.g. "REST /api/v1, JWT bearer"'),
        notes: z.string().optional().describe('Anything else a future reader should know'),
      },
      async ({ from, to, relation, contract, notes }) => {
        try {
          const source = await resolver.resolve(from);
          const target = await resolver.resolve(to);
          const projectPath = join(source.contextDir, CONTEXT_FILES.PROJECT);
          const data = (await fileExists(projectPath)) ? await readJSON<Project>(projectPath) : ({ name: source.name } as Project);

          const entry: RelatedProject = {
            name: target.name,
            relation,
            ...(contract ? { contract } : {}),
            ...(notes ? { notes } : {}),
          };
          const related = (data.relatedProjects ?? []).filter(r => r.name.toLowerCase() !== target.name.toLowerCase());
          related.push(entry);
          data.relatedProjects = related;
          await writeJSON(projectPath, data);

          const state = new StateManager(source.contextDir);
          state.trackManual(CONTEXT_FILES.PROJECT, 'relatedProjects', related);
          state.save();

          await ensureFreshIndex(true);
          return text(JSON.stringify({ from: source.name, ...entry }, null, 2));
        } catch (e) {
          return errorResult(e);
        }
      }
    );

    server.tool(
      'prelude_workspace_refresh',
      'Rebuild the workspace index after adding projects or running prelude update in one of them.',
      {},
      async () => {
        try {
          const index = await ensureFreshIndex(true);
          const mapped = index.projects.filter(p => p.hasMap).length;
          const missing = index.projects.filter(p => p.missing).length;
          return text(`Indexed ${index.projects.length} project(s): ${mapped} with a map${missing ? `, ${missing} missing` : ''}.`);
        } catch (e) {
          return errorResult(e);
        }
      }
    );

    server.resource(
      'workspace-index',
      'prelude://workspace/index',
      async (uri) => {
        const index = await ensureFreshIndex();
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(index, null, 2) }],
        };
      }
    );

    server.resource(
      'workspace-project-compact',
      new ResourceTemplate('prelude://workspace/{project}/compact', { list: undefined }),
      async (uri, variables) => {
        const p = await resolver.resolve(String(variables.project));
        const output = await exportCompact(p.rootDir, { maxTokens: 800 });
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: output }] };
      }
    );
  }

  // --- Resources (passive context) ---

  server.resource(
    'full-context',
    'prelude://context/full',
    async (uri) => {
      const { exportToMarkdown } = await import('../core/exporter.js');
      const p = await resolver.resolve();
      const markdown = await exportToMarkdown(p.rootDir);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: markdown,
        }],
      };
    }
  );

  server.resource(
    'compact-context',
    'prelude://context/compact',
    async (uri) => {
      const p = await resolver.resolve();
      const output = await exportCompact(p.rootDir, { maxTokens: 800 });
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/plain',
          text: output,
        }],
      };
    }
  );

  server.resource(
    'map',
    'prelude://context/map',
    async (uri) => {
      const p = await resolver.resolve();
      const mapPath = join(p.contextDir, CONTEXT_FILES.MAP);
      const exists = await fileExists(mapPath);
      return {
        contents: [{
          uri: uri.href,
          mimeType: exists ? 'application/json' : 'text/plain',
          text: exists
            ? JSON.stringify(await readJSON(mapPath), null, 2)
            : 'Context file not found: map.json. Run `prelude update` to generate it.',
        }],
      };
    }
  );

  server.resource(
    'context-by-type',
    new ResourceTemplate('prelude://context/{type}', { list: undefined }),
    async (uri, variables) => {
      const typeStr = variables.type as string;
      const fileMap: Record<string, string> = {
        project: CONTEXT_FILES.PROJECT,
        stack: CONTEXT_FILES.STACK,
        architecture: CONTEXT_FILES.ARCHITECTURE,
        constraints: CONTEXT_FILES.CONSTRAINTS,
        decisions: CONTEXT_FILES.DECISIONS,
        map: CONTEXT_FILES.MAP,
      };

      const filename = fileMap[typeStr];
      if (!filename) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Unknown context type: ${typeStr}. Valid types: ${Object.keys(fileMap).join(', ')}`,
          }],
        };
      }

      const p = await resolver.resolve();
      const filePath = join(p.contextDir, filename);
      if (!(await fileExists(filePath))) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Context file not found: ${filename}. Run \`prelude init\` to generate it.`,
          }],
        };
      }

      const data = await readJSON(filePath);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      };
    }
  );

  return server;
}
