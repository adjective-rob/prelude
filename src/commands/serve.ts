import type { CAC } from 'cac';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPreludeServer } from '../mcp/server.js';
import { fileExists } from '../utils/fs.js';
import { resolveContextDir } from '../runtime/context.js';
import { loadWorkspace } from '../core/workspace.js';

export function registerServeCommand(cli: CAC) {
  cli
    .command('serve', 'Start Prelude as an MCP server (stdio transport)')
    .option('--root <path>', 'Root directory of the project (default: cwd)')
    .option('--workspace', 'Serve every project registered with `prelude workspace add`')
    .action(async (options: { root?: string; workspace?: boolean }) => {
      // stdout is the MCP transport: all diagnostics go to stderr
      if (options.workspace) {
        const ws = await loadWorkspace();
        if (ws.projects.length === 0) {
          process.stderr.write('No projects registered. Run `prelude workspace add <path>`.\n');
          process.exit(1);
        }
        const server = createPreludeServer({ workspace: true });
        await server.connect(new StdioServerTransport());
        process.stderr.write(`Prelude MCP server started (workspace, ${ws.projects.length} projects)\n`);
        return;
      }

      const rootDir = options.root || process.cwd();
      if (!(await fileExists(resolveContextDir(rootDir)))) {
        process.stderr.write('Error: .context/ directory not found. Run `prelude init` first.\n');
        process.exit(1);
      }

      const server = createPreludeServer({ rootDir });
      await server.connect(new StdioServerTransport());
      process.stderr.write(`Prelude MCP server started for: ${rootDir}\n`);
    });
}
