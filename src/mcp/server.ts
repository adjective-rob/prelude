import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { executeQuery, VALID_TYPES } from '../core/query-engine.js';
import { exportCompact } from '../core/compact.js';
import { fileExists, readJSON } from '../utils/fs.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';
import type { ContextType } from '../core/query-engine.js';

export function createPreludeServer(rootDir: string): McpServer {
  const server = new McpServer({
    name: 'prelude-context',
    version: '1.4.3',
  });

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
        const { output, tokenEstimate } = await executeQuery(rootDir, {
          topic,
          scope,
          type,
          format,
          maxTokens: max_tokens,
        });
        return {
          content: [{ type: 'text' as const, text: output }],
          _meta: { tokenEstimate },
        };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
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
        const output = await exportCompact(rootDir, {
          topic,
          scope,
          maxTokens: max_tokens,
        });
        return { content: [{ type: 'text' as const, text: output }] };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'prelude_status',
    'Check Prelude status — which context files exist and basic project info.',
    {},
    async () => {
      try {
        const externalRoot = process.env.PRELUDE_ROOT;
        const contextDir = externalRoot
          ? join(externalRoot, rootDir.split('/').pop() as string)
          : join(rootDir, CONTEXT_DIR);

        const fileNames = [
          CONTEXT_FILES.PROJECT,
          CONTEXT_FILES.STACK,
          CONTEXT_FILES.ARCHITECTURE,
          CONTEXT_FILES.CONSTRAINTS,
          CONTEXT_FILES.DECISIONS,
        ];

        const existResults = await Promise.all(
          fileNames.map(f => fileExists(join(contextDir, f)))
        );
        const files = fileNames.filter((_, i) => existResults[i]);

        let project: { name?: string; description?: string } | null = null;
        if (existResults[0]) {
          const data = await readJSON<{ name?: string; description?: string }>(
            join(contextDir, CONTEXT_FILES.PROJECT)
          );
          project = { name: data.name, description: data.description };
        }

        const status = { contextDir, files, project };
        return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
