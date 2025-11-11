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

export function registerInitCommand(cli: CAC) {
  cli
    .command('init [dir]', 'Initialize .context/ directory with inferred metadata')
    .option('--force', 'Overwrite existing .context/ directory')
    .action(async (dir: string = process.cwd(), options: { force?: boolean }) => {
      const rootDir = dir;
      const contextDir = join(rootDir, CONTEXT_DIR);
      
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
      
      // Infer and write project metadata
      const projectSpin = spinner('Analyzing project metadata...');
      try {
        const project = await inferProjectMetadata(rootDir);
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
      logger.info('\nNext steps:');
      logger.info('  • Run `prelude export` to generate LLM-optimized context');
      logger.info('  • Run `prelude watch` to track changes');
      logger.info('  • Run `prelude decision "Title"` to log a decision');
    });
}