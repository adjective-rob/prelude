#!/usr/bin/env node

import { cac } from 'cac';
import { getPackageVersion } from '../src/utils/version.js';

const cli = cac('prelude');

cli
  .version(getPackageVersion())
  .help();

// Import commands
import { registerInitCommand } from '../src/commands/init.js';
import { registerExportCommand } from '../src/commands/export.js';
import { registerShareCommand } from '../src/commands/share.js';
import { registerDecisionCommand } from '../src/commands/decision.js';
import { registerWatchCommand } from '../src/commands/watch.js';
import { registerQueryCommand } from '../src/commands/query.js';
import { registerCompactCommand } from '../src/commands/compact.js';
import { registerServeCommand } from '../src/commands/serve.js';
import { registerMcpConfigCommand } from '../src/commands/mcp-config.js';
import { registerValidateCommand } from '../src/commands/validate.js';
import { registerLocateCommand } from '../src/commands/locate.js';
import { registerAnnotateCommand } from '../src/commands/annotate.js';
import { registerDiffCommand } from '../src/commands/diff.js';
import { update } from '../src/commands/update.js';

// Register all commands
registerInitCommand(cli);
registerExportCommand(cli);
registerShareCommand(cli);
registerDecisionCommand(cli);
registerWatchCommand(cli);
registerQueryCommand(cli);
registerCompactCommand(cli);
registerServeCommand(cli);
registerMcpConfigCommand(cli);
registerValidateCommand(cli);
registerLocateCommand(cli);
registerAnnotateCommand(cli);
registerDiffCommand(cli);

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