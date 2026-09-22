import type { CAC } from 'cac';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPreludeServer } from '../mcp/server.js';
import { fileExists } from '../utils/fs.js';
import { resolveContextDir } from '../runtime/context.js';

export function registerServeCommand(cli: CAC) {
  cli
    .command('serve', 'Start Prelude as an MCP server (stdio transport)')
    .option('--root <path>', 'Root directory of the project (default: cwd)')
    .action(async (options: { root?: string }) => {
      const rootDir = options.root || process.cwd();

      // Validate .context/ exists
      const contextDir = resolveContextDir(rootDir);

      if (!(await fileExists(contextDir))) {
        // Write to stderr since stdout is the MCP transport
        process.stderr.write(
          'Error: .context/ directory not found. Run `prelude init` first.\n'
        );
        process.exit(1);
      }

      const server = createPreludeServer(rootDir);
      const transport = new StdioServerTransport();
      await server.connect(transport);

      // Log to stderr (stdout is MCP transport)
      process.stderr.write(`Prelude MCP server started for: ${rootDir}\n`);
    });
}
