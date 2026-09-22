import { existsSync } from 'fs';
import { join } from 'path';
import { StateManager } from '../core/state-manager.js';
import { trackMapFields } from '../core/merger.js';
import { computeDiff, formatChanges } from '../core/diff.js';
import { writeJSON } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { resolveContextDir } from '../runtime/context.js';
import { CONTEXT_FILES } from '../constants.js';

export interface UpdateOptions {
  force?: boolean;      // Write everything even when nothing drifted
  dryRun?: boolean;     // Show what would change without applying
  interactive?: boolean; // Prompt for each change
  silent?: boolean;     // Minimal output
}

/**
 * Update context by re-analyzing codebase
 */
export async function update(options: UpdateOptions = {}) {
  const rootDir = process.cwd();
  const contextDir = resolveContextDir(rootDir);

  // Check if context exists
  if (!existsSync(contextDir)) {
    logger.error('No .context directory found. Run `prelude init` first.');
    process.exit(1);
  }

  if (!options.silent) {
    logger.info('🔄 Updating context...\n');
  }

  try {
    if (!options.silent) {
      logger.info('Analyzing codebase...');
    }

    const diff = await computeDiff(rootDir, {
      onMapError: (e) => logger.warn(`Skipping map.json: ${e instanceof Error ? e.message : String(e)}`),
    });
    const { merged, inferred, stateManager } = diff;

    if (options.force && options.dryRun) {
      logger.info('🔍 Force mode would overwrite all inferred context files');
      logger.info('(decisions.json, changelog.md, and hand-curated fields preserved)');
      return;
    }

    if (!options.force && diff.drift.length === 0) {
      // Rank/export churn is not drift, but keep map.json current
      if (!options.dryRun && merged.map && inferred.map) {
        await writeJSON(join(contextDir, CONTEXT_FILES.MAP), merged.map);
        trackMapFields(stateManager, merged.map, inferred.map);
        stateManager.save();
      }
      logger.success('✓ Context is up to date, no changes needed');
      return;
    }

    if (!options.silent && diff.changes.length > 0) {
      console.log('');
      console.log(formatChanges(diff.changes, { color: true }));
    }

    // Dry run - don't apply changes
    if (options.dryRun) {
      logger.info('🔍 Dry run complete - no changes applied');
      logger.info('Run `prelude update` to apply these changes');
      return;
    }

    // Interactive mode - prompt for each change
    if (options.interactive) {
      logger.warn('Interactive mode not yet implemented - applying all changes');
    }

    // Create backup before updating
    stateManager.backup();
    if (!options.silent) {
      logger.success('✓ Created backup of current state');
    }

    // Apply changes
    await writeJSON(join(contextDir, CONTEXT_FILES.PROJECT), merged.project);
    await writeJSON(join(contextDir, CONTEXT_FILES.STACK), merged.stack);
    await writeJSON(join(contextDir, CONTEXT_FILES.ARCHITECTURE), merged.architecture);
    await writeJSON(join(contextDir, CONTEXT_FILES.CONSTRAINTS), merged.constraints);
    if (merged.map) {
      await writeJSON(join(contextDir, CONTEXT_FILES.MAP), merged.map);
    }

    // Update state tracking
    trackAllFields(stateManager, CONTEXT_FILES.PROJECT, merged.project, inferred.project);
    trackAllFields(stateManager, CONTEXT_FILES.STACK, merged.stack, inferred.stack);
    trackAllFields(stateManager, CONTEXT_FILES.ARCHITECTURE, merged.architecture, inferred.architecture);
    trackAllFields(stateManager, CONTEXT_FILES.CONSTRAINTS, merged.constraints, inferred.constraints);
    if (merged.map && inferred.map) {
      trackMapFields(stateManager, merged.map, inferred.map);
    }
    stateManager.save();

    if (!options.silent) {
      if (options.force) {
        logger.success('✅ Force update complete');
        logger.info('ℹ️  All context files overwritten (except decisions.json and changelog.md)');
      } else {
        logger.success(`\n✅ Context updated successfully! (${diff.drift.length} changes applied)`);
        logger.info('ℹ️  Run `prelude export` to generate fresh output');
      }
    }

  } catch (error: any) {
    logger.error(`Update failed: ${error.message}`);
    process.exit(1);
  }
}

// Bookkeeping fields: never tracked, so they can never become "manual"
const UNTRACKED_FIELDS = new Set(['createdAt', 'updatedAt', '$schema', 'version']);

/**
 * Track all fields in state manager
 */
function trackAllFields(
  stateManager: StateManager,
  file: string,
  merged: any,
  inferred: any
) {
  for (const key of Object.keys(merged)) {
    if (UNTRACKED_FIELDS.has(key)) continue;
    const mergedValue = merged[key];
    const inferredValue = inferred[key];

    // Skip undefined values
    if (mergedValue === undefined) continue;

    // If values are the same, track as inferred
    if (JSON.stringify(mergedValue) === JSON.stringify(inferredValue)) {
      stateManager.trackInferred(file, key, mergedValue);
    } else {
      // Otherwise, track as manual
      stateManager.trackManual(file, key, mergedValue);
    }
  }
}
