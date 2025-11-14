#!/usr/bin/env node

import { cac } from 'cac';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get package.json - works in both dev and built versions
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try built location first (dist/bin), then dev location (bin)
let packageJson: any;
try {
  packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
} catch {
  packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
}

const cli = cac('prelude');

cli
  .version(packageJson.version)
  .help();

// Import commands
import { registerInitCommand } from '../src/commands/init.js';
import { registerExportCommand } from '../src/commands/export.js';
import { registerShareCommand } from '../src/commands/share.js';
import { registerDecisionCommand } from '../src/commands/decision.js';
import { registerWatchCommand } from '../src/commands/watch.js';
import { update } from '../src/commands/update.js';

// Register all commands
registerInitCommand(cli);
registerExportCommand(cli);
registerShareCommand(cli);
registerDecisionCommand(cli);
registerWatchCommand(cli);

// Register update command
cli
  .command('update', 'Update context by re-analyzing the codebase')
  .option('--force', 'Overwrite all inferred fields')
  .option('--dry-run', 'Show what would change without applying')
  .option('--interactive', 'Prompt for each change')
  .option('--silent', 'Minimal output')
  .action(update);

// Parse and run
cli.parse();