import type { CAC } from 'cac';
import { resolve } from 'path';
import { execSync } from 'child_process';

export function registerMcpConfigCommand(cli: CAC) {
  cli
    .command('mcp-config', 'Print MCP server configuration for AI tool integration')
    .option('--root <path>', 'Project root directory (default: cwd)')
    .option('--client <name>', 'Target client: claude-desktop, claude-code, cursor', { default: 'claude-code' })
    .action(async (options: { root?: string; client?: string }) => {
      const rootDir = resolve(options.root || process.cwd());

      // Find the prelude binary path
      let preludePath: string;
      try {
        preludePath = execSync('which prelude', { encoding: 'utf-8' }).trim();
      } catch {
        // Fallback: assume npx
        preludePath = 'npx';
      }

      const isNpx = preludePath === 'npx';
      const command = isNpx ? 'npx' : preludePath;
      const args = isNpx
        ? ['prelude-context', 'serve', '--root', rootDir]
        : ['serve', '--root', rootDir];

      const serverConfig = {
        command,
        args,
      };

      const client = options.client || 'claude-code';

      if (client === 'claude-code') {
        // Claude Code uses: claude mcp add <name> -- <command> <args...>
        const addCommand = isNpx
          ? `claude mcp add prelude-context -- npx prelude-context serve --root ${rootDir}`
          : `claude mcp add prelude-context -- ${preludePath} serve --root ${rootDir}`;

        console.log('# Claude Code\n');
        console.log('Run this command:\n');
        console.log(`  ${addCommand}\n`);
        console.log('Or add to .mcp.json in your project root:\n');
        console.log(JSON.stringify({
          mcpServers: {
            'prelude-context': serverConfig
          }
        }, null, 2));
      } else if (client === 'claude-desktop') {
        // Claude Desktop uses claude_desktop_config.json
        console.log('# Claude Desktop\n');
        console.log('Add to ~/Library/Application Support/Claude/claude_desktop_config.json:\n');
        console.log(JSON.stringify({
          mcpServers: {
            'prelude-context': serverConfig
          }
        }, null, 2));
      } else if (client === 'cursor') {
        console.log('# Cursor\n');
        console.log('Add to .cursor/mcp.json in your project root:\n');
        console.log(JSON.stringify({
          mcpServers: {
            'prelude-context': serverConfig
          }
        }, null, 2));
      } else {
        // Generic MCP config
        console.log('# MCP Server Configuration\n');
        console.log(JSON.stringify({
          'prelude-context': serverConfig
        }, null, 2));
      }
    });
}
