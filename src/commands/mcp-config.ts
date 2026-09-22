import type { CAC } from 'cac';
import { resolve } from 'path';
import { execSync } from 'child_process';

interface ServerSpec {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function findPreludeBinary(): string | undefined {
  try {
    return execSync('which prelude', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function jsonConfig(spec: ServerSpec): string {
  const entry: Record<string, unknown> = { command: spec.command, args: spec.args };
  if (spec.env) entry.env = spec.env;
  return JSON.stringify({ mcpServers: { [spec.name]: entry } }, null, 2);
}

function tomlConfig(spec: ServerSpec): string {
  const q = (s: string) => JSON.stringify(s);
  let out = `[mcp_servers.${spec.name}]\ncommand = ${q(spec.command)}\nargs = [${spec.args.map(q).join(', ')}]\n`;
  if (spec.env) {
    out += `\n[mcp_servers.${spec.name}.env]\n`;
    for (const [k, v] of Object.entries(spec.env)) out += `${k} = ${q(v)}\n`;
  }
  return out;
}

/** Build the printed setup text for one client. Exported for tests. */
export function renderMcpConfig(client: string, spec: ServerSpec, workspace: boolean): string {
  const lines: string[] = [];
  const envFlags = Object.entries(spec.env ?? {}).map(([k, v]) => `-e ${k}=${shellQuote(v)} `).join('');
  const scope = workspace ? '--scope user ' : '';
  const addCommand = `claude mcp add ${scope}${envFlags}${spec.name} -- ${[spec.command, ...spec.args].map(shellQuote).join(' ')}`;
  const everywhere = 'User-scope registration makes Prelude available in every session on this machine.';

  if (client === 'claude-code') {
    lines.push('# Claude Code', '', 'Run this command:', '', `  ${addCommand}`, '');
    if (workspace) {
      lines.push(everywhere, '', 'Or add to the mcpServers section of ~/.claude.json:', '');
    } else {
      lines.push('Or add to .mcp.json in your project root:', '');
    }
    lines.push(jsonConfig(spec));
  } else if (client === 'claude-desktop') {
    lines.push('# Claude Desktop', '', 'Add to ~/Library/Application Support/Claude/claude_desktop_config.json:', '');
    lines.push(jsonConfig(spec));
  } else if (client === 'cursor') {
    lines.push('# Cursor', '');
    if (workspace) lines.push(everywhere, '');
    lines.push(workspace ? 'Add to ~/.cursor/mcp.json:' : 'Add to .cursor/mcp.json in your project root:', '');
    lines.push(jsonConfig(spec));
  } else if (client === 'codex') {
    lines.push('# Codex', '');
    if (workspace) lines.push(everywhere, '');
    lines.push('Add to ~/.codex/config.toml:', '');
    lines.push(tomlConfig(spec));
  } else {
    lines.push('# MCP Server Configuration', '');
    lines.push(JSON.stringify({ [spec.name]: { command: spec.command, args: spec.args, ...(spec.env ? { env: spec.env } : {}) } }, null, 2));
  }
  return lines.join('\n');
}

export function registerMcpConfigCommand(cli: CAC) {
  cli
    .command('mcp-config', 'Print MCP server configuration for AI tool integration')
    .option('--root <path>', 'Project root directory (default: cwd)')
    .option('--workspace', 'Configure one user-scope server for every workspace project')
    .option('--client <name>', 'Target client: claude-code, claude-desktop, cursor, codex', { default: 'claude-code' })
    .action(async (options: { root?: string; client?: string; workspace?: boolean }) => {
      const binary = findPreludeBinary();
      const workspace = Boolean(options.workspace);
      const serveArgs = workspace ? ['serve', '--workspace'] : ['serve', '--root', resolve(options.root || process.cwd())];

      const spec: ServerSpec = {
        name: workspace ? 'prelude' : 'prelude-context',
        command: binary ?? 'npx',
        args: binary ? serveArgs : ['-y', 'prelude-context', ...serveArgs],
      };
      if (process.env.PRELUDE_HOME) spec.env = { PRELUDE_HOME: process.env.PRELUDE_HOME };

      console.log(renderMcpConfig(options.client || 'claude-code', spec, workspace));
    });
}
