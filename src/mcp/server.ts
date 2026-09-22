import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, basename, resolve } from 'path';
import { executeQuery, VALID_TYPES, truncateToTokenBudget, estimateTokens } from '../core/query-engine.js';
import { exportCompact } from '../core/compact.js';
import { loadLocateContext, locateInMap, formatLocateText } from '../core/locate.js';
import { addDecision } from '../core/decisions.js';
import { annotateModule, formatModuleLine, normalizeModulePath } from '../core/map-annotate.js';
import { formatMapBody } from '../core/map-format.js';
import { fileExists, readJSON } from '../utils/fs.js';
import { getPackageVersion } from '../utils/version.js';
import { CONTEXT_FILES } from '../constants.js';
import { resolveContextDir } from '../runtime/context.js';
import type { ContextType } from '../core/query-engine.js';
import type { CodeMap, MapModule } from '../schema/index.js';

const SINGLE_INSTRUCTIONS =
  'Prelude serves committed context about this codebase. Recommended flow: ' +
  'call prelude_compact for an overview, prelude_locate to find the files for ' +
  'your task, then read those files. Record choices with ' +
  'prelude_record_decision and fix wrong module descriptions with ' +
  'prelude_annotate_module so the next session benefits.';

export interface ResolvedProject {
  name: string;
  rootDir: string;
  contextDir: string;
}

export interface ProjectResolver {
  mode: 'single' | 'workspace';
  resolve(project?: string): Promise<ResolvedProject>;
}

function singleProjectResolver(rootDir: string): ProjectResolver {
  const abs = resolve(rootDir);
  const project: ResolvedProject = { name: basename(abs), rootDir: abs, contextDir: resolveContextDir(abs) };
  return { mode: 'single', resolve: async () => project };
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

export function text(value: string, meta?: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text' as const, text: value }], ...(meta ? { _meta: meta } : {}) };
}

export function errorResult(e: unknown): ToolResult {
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

export function createPreludeServer(rootDir: string): McpServer {
  const resolver = singleProjectResolver(rootDir);
  const server = new McpServer(
    { name: 'prelude-context', version: getPackageVersion() },
    { instructions: SINGLE_INSTRUCTIONS }
  );

  server.tool(
    'prelude_query',
    'Query project context by topic, scope, or type. Returns structured context about the codebase.',
    {
      topic: z.string().optional().describe('Filter context by topic keyword (e.g. "database", "auth", "testing")'),
      scope: z.string().optional().describe('Filter to a specific directory path (e.g. "src/api", "packages/db")'),
      type: z.enum(VALID_TYPES as [ContextType, ...ContextType[]]).optional().describe('Return only a specific context type'),
      format: z.enum(['md', 'json']).default('md').describe('Output format — md for reading, json for parsing'),
      max_tokens: z.number().positive().optional().describe('Approximate token budget for the response'),
    },
    async ({ topic, scope, type, format, max_tokens }) => {
      if (!topic && !scope && !type) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Provide at least one filter — topic, scope, or type.' }],
          isError: true,
        };
      }
      try {
        const p = await resolver.resolve();
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
      topic: z.string().optional().describe('Filter context by topic keyword'),
      scope: z.string().optional().describe('Filter to a specific directory path'),
      max_tokens: z.number().positive().default(800).describe('Token budget (default 800)'),
    },
    async ({ topic, scope, max_tokens }) => {
      try {
        const p = await resolver.resolve();
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
    {},
    async () => {
      try {
        const p = await resolver.resolve();
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

        let project: { name?: string; description?: string } | null = null;
        if (existResults[0]) {
          const data = await readJSON<{ name?: string; description?: string }>(join(p.contextDir, CONTEXT_FILES.PROJECT));
          project = { name: data.name, description: data.description };
        }

        const status = { contextDir: p.contextDir, files, project };
        return text(JSON.stringify(status, null, 2));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_locate',
    'Find the files most relevant to a task before reading or grepping. Give a short phrase describing what you need to change or understand (e.g. \'billing checkout webhook\', \'where manual edits are preserved\'). Returns ranked files with the reason each matched. Call this first when you do not already know which file to open.',
    {
      query: z.string().describe('Short phrase describing what you need to find'),
      limit: z.number().int().positive().max(25).default(8).describe('Maximum files to return (default 8, max 25)'),
      scope: z.string().optional().describe('Only consider files under this directory'),
      include_tests: z.boolean().optional().describe('Include test files (default: only when the query mentions tests)'),
    },
    async ({ query, limit, scope, include_tests }) => {
      try {
        if (!query.trim()) throw new Error('Provide a non-empty query.');
        const p = await resolver.resolve();
        const ctx = await loadLocateContext(p.rootDir);
        const hits = locateInMap(ctx.map, query, { limit, scope, includeTests: include_tests }, {
          decisions: ctx.decisions,
          architecture: ctx.architecture,
        });
        return text(formatLocateText(hits, query, ctx.map), { hits });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    'prelude_map',
    'Inspect the code map. With no arguments, returns the hub files to read first and a one-line summary of every module. With `module`, returns that module\'s purpose, notes, dependencies, tests, and files with exports. With `file`, returns that file\'s exports, resolved imports, importers count, and the module it belongs to.',
    {
      module: z.string().optional().describe('Module path, e.g. "src/core"'),
      file: z.string().optional().describe('File path relative to the project root'),
      max_tokens: z.number().positive().default(1200).describe('Approximate token budget (default 1200)'),
    },
    async ({ module, file, max_tokens }) => {
      try {
        const p = await resolver.resolve();
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
      title: z.string().describe('Short title, under 80 characters'),
      rationale: z.string().describe('Why this was decided'),
      alternatives: z.array(z.string()).optional().describe('Alternatives considered'),
      impact: z.string().optional().describe('What this changes for the codebase'),
      tags: z.array(z.string()).optional().describe('Keywords, e.g. ["auth", "database"]'),
      status: z.enum(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']).default('accepted'),
      author: z.string().optional().describe('Who made the decision (default "agent")'),
    },
    async ({ title, rationale, alternatives, impact, tags, status, author }) => {
      try {
        const p = await resolver.resolve();
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
      path: z.string().describe('Module path, e.g. "src/core"'),
      purpose: z.string().optional().describe('Short phrase describing what the module is for'),
      notes: z.string().optional().describe('Notes for future readers'),
    },
    async ({ path, purpose, notes }) => {
      try {
        if (!purpose && !notes) throw new Error('Provide purpose, notes, or both.');
        const p = await resolver.resolve();
        const mod = await annotateModule(p.contextDir, path, { purpose, notes });
        return text(formatModuleLine(mod));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

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
