import type { CAC } from 'cac';
import { logger } from '../utils/log.js';
import { resolveContextDir } from '../runtime/context.js';
import { annotateModule, formatModuleLine } from '../core/map-annotate.js';

export function registerAnnotateCommand(cli: CAC) {
  cli
    .command('annotate <module>', 'Set a module purpose or notes in map.json (preserved by prelude update)')
    .option('--purpose <text>', 'Short phrase describing what the module is for')
    .option('--notes <text>', 'Notes for future readers (gotchas, entry points, ownership)')
    .option('--clear-notes', 'Remove existing notes')
    .action(async (modulePath: string, options: { purpose?: string; notes?: string; clearNotes?: boolean }) => {
      if (!options.purpose && !options.notes && !options.clearNotes) {
        logger.error('Provide --purpose, --notes, or --clear-notes.');
        process.exit(1);
      }
      try {
        const mod = await annotateModule(resolveContextDir(process.cwd()), modulePath, {
          purpose: options.purpose,
          notes: options.notes,
          clearNotes: options.clearNotes,
        });
        console.log(formatModuleLine(mod));
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
