import { existsSync } from 'fs';
import { join } from 'path';
import { StateManager } from '../core/state-manager.js';
import { ContextMerger, type MergeChange } from '../core/merger.js';
import { inferProjectMetadata, inferStack, inferArchitecture, inferConstraints } from '../core/infer.js';
import { readJSON, writeJSON } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import type { Project, Stack, Architecture, Constraints } from '../schema/index.js';

export interface UpdateOptions {
  force?: boolean;      // Overwrite everything except decisions/changelog
  dryRun?: boolean;     // Show what would change without applying
  interactive?: boolean; // Prompt for each change
  silent?: boolean;     // Minimal output
}

/**
 * Update context by re-analyzing codebase
 */
export async function update(options: UpdateOptions = {}) {
  const contextDir = '.context';
  
  // Check if context exists
  if (!existsSync(contextDir)) {
    logger.error('No .context directory found. Run `prelude init` first.');
    process.exit(1);
  }

  if (!options.silent) {
    logger.info('🔄 Updating context...\n');
  }

  try {
    // Initialize state manager
    const stateManager = new StateManager(contextDir);
    
    // Create backup before updating
    if (!options.dryRun) {
      stateManager.backup();
      if (!options.silent) {
        logger.success('✓ Created backup of current state');
      }
    }

    // Read existing context
    const existing = {
      project: await readJSON<Project>(join(contextDir, 'project.json')),
      stack: await readJSON<Stack>(join(contextDir, 'stack.json')),
      architecture: await readJSON<Architecture>(join(contextDir, 'architecture.json')),
      constraints: await readJSON<Constraints>(join(contextDir, 'constraints.json')),
    };

    // Re-infer from codebase
    if (!options.silent) {
      logger.info('Analyzing codebase...');
    }
    
    const inferred = {
      project: await inferProjectMetadata(process.cwd()),
      stack: await inferStack(process.cwd()),
      architecture: await inferArchitecture(process.cwd()),
      constraints: await inferConstraints(process.cwd()),
    };

    if (options.force) {
      // Force mode: overwrite everything except decisions/changelog
      return await forceUpdate(contextDir, inferred, options);
    }

    // Smart merge mode
    const merger = new ContextMerger(stateManager);
    
    const projectResult = merger.mergeProject(existing.project, inferred.project);
    const stackResult = merger.mergeStack(existing.stack, inferred.stack);
    const architectureResult = merger.mergeArchitecture(existing.architecture, inferred.architecture);
    const constraintsResult = merger.mergeConstraints(existing.constraints, inferred.constraints);

    const allChanges = [
      ...projectResult.changes.map(c => ({ file: 'project.json', ...c })),
      ...stackResult.changes.map(c => ({ file: 'stack.json', ...c })),
      ...architectureResult.changes.map(c => ({ file: 'architecture.json', ...c })),
      ...constraintsResult.changes.map(c => ({ file: 'constraints.json', ...c })),
    ];

    // Show changes
    if (allChanges.length === 0) {
      logger.success('✓ Context is up to date, no changes needed');
      return;
    }

    if (!options.silent) {
      console.log('');
      displayChanges(allChanges);
      console.log('');
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
      // TODO: Implement interactive prompts
    }

    // Apply changes
    await writeJSON(join(contextDir, 'project.json'), projectResult.merged);
    await writeJSON(join(contextDir, 'stack.json'), stackResult.merged);
    await writeJSON(join(contextDir, 'architecture.json'), architectureResult.merged);
    await writeJSON(join(contextDir, 'constraints.json'), constraintsResult.merged);

    // Update state tracking
    trackAllFields(stateManager, 'project.json', projectResult.merged, inferred.project);
    trackAllFields(stateManager, 'stack.json', stackResult.merged, inferred.stack);
    trackAllFields(stateManager, 'architecture.json', architectureResult.merged, inferred.architecture);
    trackAllFields(stateManager, 'constraints.json', constraintsResult.merged, inferred.constraints);
    
    stateManager.save();

    if (!options.silent) {
      logger.success(`\n✅ Context updated successfully! (${allChanges.length} changes applied)`);
      logger.info('ℹ️  Run `prelude export` to generate fresh output');
    }

  } catch (error: any) {
    logger.error(`Update failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Force update - overwrites everything
 */
async function forceUpdate(
  contextDir: string,
  inferred: any,
  options: UpdateOptions
) {
  if (options.dryRun) {
    logger.info('🔍 Force mode would overwrite all context files');
    logger.info('(decisions.json and changelog.md will be preserved)');
    return;
  }

  // Write inferred context
  await writeJSON(join(contextDir, 'project.json'), inferred.project);
  await writeJSON(join(contextDir, 'stack.json'), inferred.stack);
  await writeJSON(join(contextDir, 'architecture.json'), inferred.architecture);
  await writeJSON(join(contextDir, 'constraints.json'), inferred.constraints);

  // Preserve decisions and changelog (they're already on disk)

  if (!options.silent) {
    logger.success('✅ Force update complete');
    logger.info('ℹ️  All context files overwritten (except decisions.json and changelog.md)');
  }
}

/**
 * Display changes in a readable format
 */
function displayChanges(changes: Array<MergeChange & { file: string }>) {
  const grouped = changes.reduce((acc, change) => {
    if (!acc[change.file]) acc[change.file] = [];
    acc[change.file].push(change);
    return acc;
  }, {} as Record<string, MergeChange[]>);

  for (const [file, fileChanges] of Object.entries(grouped)) {
    logger.info(`📄 ${file}:`);
    
    for (const change of fileChanges) {
      const icon = {
        added: '  + ',
        removed: '  - ',
        modified: '  ~ ',
        preserved: '  ✓ ',
      }[change.type];

      const color = {
        added: '\x1b[32m',    // Green
        removed: '\x1b[31m',  // Red
        modified: '\x1b[33m', // Yellow
        preserved: '\x1b[36m', // Cyan
      }[change.type];

      const reset = '\x1b[0m';

      console.log(`${icon}${color}${change.field}${reset} - ${change.reason}`);
      
      if (change.oldValue !== undefined) {
        console.log(`    Old: ${JSON.stringify(change.oldValue)}`);
      }
      if (change.newValue !== undefined) {
        console.log(`    New: ${JSON.stringify(change.newValue)}`);
      }
    }
    console.log('');
  }
}

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