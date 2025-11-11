import { join } from 'path';
import { writeJSON, readJSON, fileExists } from '../utils/fs.js';
import { getCurrentTimestamp } from '../utils/time.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';
import { inferProjectMetadata, inferStack, inferArchitecture, inferConstraints } from './infer.js';
import type { Project, Stack, Architecture, Constraints } from '../schema/index.js';

export interface UpdateResult {
  updated: string[];
  unchanged: string[];
  errors: string[];
}

export async function updateContext(rootDir: string, files: string[]): Promise<UpdateResult> {
  const result: UpdateResult = {
    updated: [],
    unchanged: [],
    errors: []
  };
  
  const contextDir = join(rootDir, CONTEXT_DIR);
  
  // Determine what needs updating based on changed files
  const needsStackUpdate = files.some(f => 
    f.includes('package.json') || 
    f.includes('requirements.txt') ||
    f.includes('Cargo.toml') ||
    f.includes('go.mod')
  );
  
  const needsArchUpdate = files.some(f => 
    f.includes('src/') || 
    f.includes('lib/') ||
    f.includes('app/') ||
    f.includes('pages/')
  );
  
  const needsConstraintsUpdate = files.some(f =>
    f.includes('tsconfig.json') ||
    f.includes('eslint') ||
    f.includes('prettier') ||
    f.includes('tailwind.config')
  );
  
  // Update stack if needed
  if (needsStackUpdate) {
    try {
      const stack = await inferStack(rootDir);
      const stackPath = join(contextDir, CONTEXT_FILES.STACK);
      await writeJSON(stackPath, stack);
      result.updated.push('stack.json');
    } catch (error) {
      result.errors.push(`Failed to update stack: ${error}`);
    }
  }
  
  // Update architecture if needed
  if (needsArchUpdate) {
    try {
      const architecture = await inferArchitecture(rootDir);
      const archPath = join(contextDir, CONTEXT_FILES.ARCHITECTURE);
      await writeJSON(archPath, architecture);
      result.updated.push('architecture.json');
    } catch (error) {
      result.errors.push(`Failed to update architecture: ${error}`);
    }
  }
  
  // Update constraints if needed
  if (needsConstraintsUpdate) {
    try {
      const constraints = await inferConstraints(rootDir);
      const constraintsPath = join(contextDir, CONTEXT_FILES.CONSTRAINTS);
      await writeJSON(constraintsPath, constraints);
      result.updated.push('constraints.json');
    } catch (error) {
      result.errors.push(`Failed to update constraints: ${error}`);
    }
  }
  
  // Always update the project's updatedAt timestamp
  try {
    const projectPath = join(contextDir, CONTEXT_FILES.PROJECT);
    if (await fileExists(projectPath)) {
      const project = await readJSON<Project>(projectPath);
      project.updatedAt = getCurrentTimestamp();
      await writeJSON(projectPath, project);
      if (!result.updated.includes('project.json')) {
        result.updated.push('project.json');
      }
    }
  } catch (error) {
    result.errors.push(`Failed to update project timestamp: ${error}`);
  }
  
  return result;
}

export async function refreshAll(rootDir: string): Promise<UpdateResult> {
  const result: UpdateResult = {
    updated: [],
    unchanged: [],
    errors: []
  };
  
  const contextDir = join(rootDir, CONTEXT_DIR);
  
  try {
    const project = await inferProjectMetadata(rootDir);
    await writeJSON(join(contextDir, CONTEXT_FILES.PROJECT), project);
    result.updated.push('project.json');
  } catch (error) {
    result.errors.push(`Failed to update project: ${error}`);
  }
  
  try {
    const stack = await inferStack(rootDir);
    await writeJSON(join(contextDir, CONTEXT_FILES.STACK), stack);
    result.updated.push('stack.json');
  } catch (error) {
    result.errors.push(`Failed to update stack: ${error}`);
  }
  
  try {
    const architecture = await inferArchitecture(rootDir);
    await writeJSON(join(contextDir, CONTEXT_FILES.ARCHITECTURE), architecture);
    result.updated.push('architecture.json');
  } catch (error) {
    result.errors.push(`Failed to update architecture: ${error}`);
  }
  
  try {
    const constraints = await inferConstraints(rootDir);
    await writeJSON(join(contextDir, CONTEXT_FILES.CONSTRAINTS), constraints);
    result.updated.push('constraints.json');
  } catch (error) {
    result.errors.push(`Failed to update constraints: ${error}`);
  }
  
  return result;
}