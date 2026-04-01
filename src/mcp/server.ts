import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function createPreludeServer(rootDir: string): McpServer {
  const server = new McpServer({
    name: 'prelude-context',
    version: '1.4.3',
  });

  // Tools will be registered here in TASK_02

  return server;
}
