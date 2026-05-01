import type { CAC } from 'cac';
import { join } from 'path';
import { ensureDir, writeJSON, writeMarkdown, fileExists } from '../utils/fs.js';
import { logger, spinner } from '../utils/log.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';
import {
  inferProjectMetadata,
  inferStack,
  inferArchitecture,
  inferConstraints
} from '../core/infer.js';
import { parseClaudeMd } from '../core/claude-md-parser.js';
import type { ClaudeMdData } from '../core/claude-md-parser.js';
import type { Project, Stack, Architecture, Constraints } from '../schema/index.js';

export function registerInitCommand(cli: CAC) {
  cli
    .command('init [dir]', 'Initialize .context/ directory with inferred metadata')
    .option('--force', 'Overwrite existing .context/ directory')
    .option('--from-claude-md [path]', 'Bootstrap from a CLAUDE.md file')
    .action(async (dir: string = process.cwd(), options: { force?: boolean; fromClaudeMd?: boolean | string }) => {
    const rootDir = dir;

    // If PRELUDE_ROOT is set, use it as base for context storage.
    // Otherwise default to repo-local .context/
    const externalRoot = process.env.PRELUDE_ROOT;
    console.log("DEBUG PRELUDE_ROOT:", externalRoot);
    console.log("RUNTIME PRELUDE_ROOT:", process.env.PRELUDE_ROOT);

const contextDir = externalRoot
  ? join(externalRoot, rootDir.split('/').pop() as string)
  : join(rootDir, CONTEXT_DIR);
      
      logger.init('Initializing Prelude context...');
      
      // Check if .context already exists
      if (await fileExists(contextDir) && !options.force) {
        logger.error('.context/ directory already exists. Use --force to overwrite.');
        process.exit(1);
      }
      
      // Create .context directory
      const spin = spinner('Creating .context/ directory...');
      await ensureDir(contextDir);
      spin.stop('✓ Created .context/ directory');

      // Parse CLAUDE.md if requested
      let claudeData: ClaudeMdData | undefined;
      if (options.fromClaudeMd !== undefined) {
        const claudeMdPath = typeof options.fromClaudeMd === 'string'
          ? join(rootDir, options.fromClaudeMd)
          : join(rootDir, 'CLAUDE.md');

        if (await fileExists(claudeMdPath)) {
          const claudeSpin = spinner(`Parsing ${typeof options.fromClaudeMd === 'string' ? options.fromClaudeMd : 'CLAUDE.md'}...`);
          try {
            claudeData = await parseClaudeMd(claudeMdPath);
            claudeSpin.stop('✓ Parsed CLAUDE.md');
          } catch (error) {
            claudeSpin.stop();
            logger.error(`Failed to parse CLAUDE.md: ${error}`);
          }
        } else {
          logger.error(`CLAUDE.md not found at ${claudeMdPath}`);
        }
      }

      // Infer and write project metadata
      const projectSpin = spinner('Analyzing project metadata...');
      try {
        const project = await inferProjectMetadata(rootDir);
        if (claudeData) {
          mergeProjectData(project, claudeData);
        }
        await writeJSON(join(contextDir, CONTEXT_FILES.PROJECT), project);
        projectSpin.stop('✓ Generated project.json');
      } catch (error) {
        projectSpin.stop();
        logger.error(`Failed to generate project.json: ${error}`);
      }

      // Infer and write stack
      const stackSpin = spinner('Detecting technology stack...');
      try {
        const stack = await inferStack(rootDir);
        if (claudeData) {
          mergeStackData(stack, claudeData);
        }
        await writeJSON(join(contextDir, CONTEXT_FILES.STACK), stack);
        stackSpin.stop('✓ Generated stack.json');
      } catch (error) {
        stackSpin.stop();
        logger.error(`Failed to generate stack.json: ${error}`);
      }

      // Infer and write architecture
      const archSpin = spinner('Mapping architecture...');
      try {
        const architecture = await inferArchitecture(rootDir);
        if (claudeData) {
          mergeArchitectureData(architecture, claudeData);
        }
        await writeJSON(join(contextDir, CONTEXT_FILES.ARCHITECTURE), architecture);
        archSpin.stop('✓ Generated architecture.json');
      } catch (error) {
        archSpin.stop();
        logger.error(`Failed to generate architecture.json: ${error}`);
      }

      // Infer and write constraints
      const constraintsSpin = spinner('Inferring constraints...');
      try {
        const constraints = await inferConstraints(rootDir);
        if (claudeData) {
          mergeConstraintsData(constraints, claudeData);
        }
        await writeJSON(join(contextDir, CONTEXT_FILES.CONSTRAINTS), constraints);
        constraintsSpin.stop('✓ Generated constraints.json');
      } catch (error) {
        constraintsSpin.stop();
        logger.error(`Failed to generate constraints.json: ${error}`);
      }
      
      // Create empty decisions.json
      await writeJSON(join(contextDir, CONTEXT_FILES.DECISIONS), { decisions: [] });
      logger.success('✓ Created decisions.json');
      
      // Create empty changelog.md
      await writeMarkdown(join(contextDir, CONTEXT_FILES.CHANGELOG), '# Changelog\n\n');
      logger.success('✓ Created changelog.md');
      
      logger.success('🎉 Prelude context initialized successfully!');
      if (claudeData) {
        logger.info('  (enriched with CLAUDE.md data)');
      }
      logger.info('\nNext steps:');
      logger.info('  • Run `prelude export` to generate LLM-optimized context');
      logger.info('  • Run `prelude watch` to track changes');
      logger.info('  • Run `prelude decision "Title"` to log a decision');
    });
}

/**
 * Merge CLAUDE.md data into inferred project metadata.
 * CLAUDE.md values take priority for non-empty fields.
 */
function mergeProjectData(project: Project, claudeData: ClaudeMdData): void {
  if (claudeData.projectName) {
    project.name = claudeData.projectName;
  }
  if (claudeData.description) {
    project.description = claudeData.description;
  }
}

function mergeStackData(stack: Stack, claudeData: ClaudeMdData): void {
  if (!claudeData.stack) return;

  if (claudeData.stack.language) {
    stack.language = claudeData.stack.language;
  }
  if (claudeData.stack.frameworks?.length) {
    // Use CLAUDE.md frameworks if inference found none, otherwise merge
    if (!stack.frameworks?.length) {
      stack.frameworks = claudeData.stack.frameworks;
    } else {
      const existing = new Set(stack.frameworks.map(f => f.toLowerCase()));
      for (const fw of claudeData.stack.frameworks) {
        if (!existing.has(fw.toLowerCase())) {
          stack.frameworks.push(fw);
        }
      }
    }
  }
  if (claudeData.stack.database && !stack.database) {
    stack.database = claudeData.stack.database;
  }
  if (claudeData.stack.testing) {
    if (!stack.testingFrameworks?.length) {
      stack.testingFrameworks = [claudeData.stack.testing];
    }
  }
}

function mergeArchitectureData(architecture: Architecture, claudeData: ClaudeMdData): void {
  if (!claudeData.architecture) return;

  if (claudeData.architecture.type) {
    const validTypes = ['monolith', 'monorepo', 'microservices', 'library', 'cli', 'fullstack', 'backend', 'frontend'] as const;
    const normalized = claudeData.architecture.type.toLowerCase() as typeof validTypes[number];
    if (validTypes.includes(normalized)) {
      architecture.type = normalized;
    }
  }

  if (claudeData.architecture.patterns?.length) {
    if (!architecture.patterns?.length) {
      architecture.patterns = claudeData.architecture.patterns;
    } else {
      const existing = new Set(architecture.patterns.map(p => p.toLowerCase()));
      for (const p of claudeData.architecture.patterns) {
        if (!existing.has(p.toLowerCase())) {
          architecture.patterns.push(p);
        }
      }
    }
  }

  if (claudeData.architecture.directories?.length) {
    // Merge directories: CLAUDE.md directories get their purpose filled in
    const existingPaths = new Set(architecture.directories.map(d => d.path));
    for (const dir of claudeData.architecture.directories) {
      const existing = architecture.directories.find(d => d.path === dir.path || d.path.endsWith('/' + dir.path) || dir.path.endsWith('/' + d.path));
      if (existing && dir.purpose && !existing.purpose) {
        existing.purpose = dir.purpose;
      } else if (!existingPaths.has(dir.path)) {
        architecture.directories.push(dir);
      }
    }
  }

  if (claudeData.conventions?.length) {
    if (!architecture.conventions?.length) {
      architecture.conventions = claudeData.conventions;
    } else {
      architecture.conventions = [...architecture.conventions, ...claudeData.conventions];
    }
  }

  if (claudeData.commands?.length) {
    // Store commands as entry points if none detected
    if (!architecture.entryPoints?.length) {
      architecture.entryPoints = claudeData.commands
        .filter(c => c.description)
        .slice(0, 10)
        .map(c => ({ file: c.name, purpose: c.description }));
    }
  }
}

function mergeConstraintsData(constraints: Constraints, claudeData: ClaudeMdData): void {
  if (claudeData.constraints?.mustUse?.length) {
    if (!constraints.mustUse?.length) {
      constraints.mustUse = claudeData.constraints.mustUse;
    } else {
      constraints.mustUse = [...constraints.mustUse, ...claudeData.constraints.mustUse];
    }
  }
  if (claudeData.constraints?.mustNotUse?.length) {
    if (!constraints.mustNotUse?.length) {
      constraints.mustNotUse = claudeData.constraints.mustNotUse;
    } else {
      constraints.mustNotUse = [...constraints.mustNotUse, ...claudeData.constraints.mustNotUse];
    }
  }
}