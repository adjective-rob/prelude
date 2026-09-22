import type { CAC } from 'cac';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJSON, fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { CONTEXT_FILES } from '../constants.js';
import { resolveContextDir } from '../runtime/context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);



// Map context files to their schema files
const FILE_SCHEMA_MAP: Record<string, string> = {
  [CONTEXT_FILES.PROJECT]: 'project.schema.json',
  [CONTEXT_FILES.STACK]: 'stack.schema.json',
  [CONTEXT_FILES.ARCHITECTURE]: 'architecture.schema.json',
  [CONTEXT_FILES.CONSTRAINTS]: 'constraints.schema.json',
  [CONTEXT_FILES.DECISIONS]: 'decisions.schema.json',
  [CONTEXT_FILES.MAP]: 'map.schema.json',
};

export interface ValidationError {
  path: string;
  message: string;
}

// Simple JSON Schema validator — no external dependencies
function validateValue(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (schema.type) {
    const schemaType = schema.type as string;

    if (schemaType === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({ path, message: `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}` });
        return errors;
      }

      const obj = value as Record<string, unknown>;

      // Check required fields
      if (Array.isArray(schema.required)) {
        for (const field of schema.required as string[]) {
          if (!(field in obj)) {
            errors.push({ path: path ? `${path}.${field}` : field, message: 'Required field missing' });
          }
        }
      }

      // Validate each property against its schema
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (properties) {
        for (const [key, propSchema] of Object.entries(properties)) {
          if (key in obj) {
            errors.push(...validateValue(obj[key], propSchema, path ? `${path}.${key}` : key));
          }
        }
      }

      // Validate additionalProperties when it's a schema (e.g., { "additionalProperties": { "type": "string" } })
      const additionalProps = schema.additionalProperties;
      if (additionalProps && typeof additionalProps === 'object') {
        const knownKeys = properties ? Object.keys(properties) : [];
        for (const [key, val] of Object.entries(obj)) {
          if (!knownKeys.includes(key)) {
            errors.push(...validateValue(val, additionalProps as Record<string, unknown>, path ? `${path}.${key}` : key));
          }
        }
      }
    } else if (schemaType === 'array') {
      if (!Array.isArray(value)) {
        errors.push({ path, message: `Expected array, got ${typeof value}` });
        return errors;
      }

      // Validate items
      const itemSchema = schema.items as Record<string, unknown> | undefined;
      if (itemSchema) {
        for (let i = 0; i < value.length; i++) {
          errors.push(...validateValue(value[i], itemSchema, `${path}[${i}]`));
        }
      }
    } else if (schemaType === 'string') {
      if (typeof value !== 'string') {
        errors.push({ path, message: `Expected string, got ${typeof value}` });
        return errors;
      }

      // Check enum
      if (Array.isArray(schema.enum)) {
        if (!(schema.enum as string[]).includes(value)) {
          errors.push({ path, message: `Value "${value}" not in enum [${(schema.enum as string[]).join(', ')}]` });
        }
      }

      // Check minLength
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        errors.push({ path, message: `String length ${value.length} is less than minimum ${schema.minLength}` });
      }
    } else if (schemaType === 'number' || schemaType === 'integer') {
      if (typeof value !== 'number') {
        errors.push({ path, message: `Expected ${schemaType}, got ${typeof value}` });
        return errors;
      }

      if (schemaType === 'integer' && !Number.isInteger(value)) {
        errors.push({ path, message: `Expected integer, got float` });
      }

      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        errors.push({ path, message: `Value ${value} is less than minimum ${schema.minimum}` });
      }

      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        errors.push({ path, message: `Value ${value} is greater than maximum ${schema.maximum}` });
      }
    } else if (schemaType === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push({ path, message: `Expected boolean, got ${typeof value}` });
      }
    }
  }

  return errors;
}

export function validateAgainstSchema(
  data: unknown,
  schema: Record<string, unknown>
): ValidationError[] {
  return validateValue(data, schema, '');
}

// Resolve schemas dir — works from both src/ (dev via tsx) and dist/ (built)
// Dev:   src/commands/validate.ts   → __dirname = .../src/commands   → ../../schemas
// Built: dist/src/commands/validate.js → __dirname = .../dist/src/commands → ../../../schemas
async function getSchemasDir(): Promise<string> {
  const devPath = join(__dirname, '..', '..', 'schemas');
  if (await fileExists(devPath)) return devPath;
  return join(__dirname, '..', '..', '..', 'schemas');
}

export interface FileValidationResult {
  file: string;
  status: 'valid' | 'invalid' | 'skipped';
  errors: ValidationError[];
}

/**
 * Validate every known context file in a context directory against its
 * JSON Schema. Missing files are reported as `skipped`, not errors.
 */
export async function validateContextDir(contextDir: string): Promise<FileValidationResult[]> {
  const schemasDir = await getSchemasDir();
  const results: FileValidationResult[] = [];

  for (const [contextFile, schemaFile] of Object.entries(FILE_SCHEMA_MAP)) {
    const filePath = join(contextDir, contextFile);
    const schemaPath = join(schemasDir, schemaFile);

    if (!(await fileExists(filePath))) {
      results.push({ file: contextFile, status: 'skipped', errors: [] });
      continue;
    }

    let schema: Record<string, unknown>;
    try {
      schema = await readJSON<Record<string, unknown>>(schemaPath);
    } catch {
      results.push({ file: contextFile, status: 'invalid', errors: [{ path: '', message: `Failed to load schema: ${schemaFile}` }] });
      continue;
    }

    let data: unknown;
    try {
      data = await readJSON<unknown>(filePath);
    } catch (error) {
      results.push({ file: contextFile, status: 'invalid', errors: [{ path: '', message: `Invalid JSON — ${error}` }] });
      continue;
    }

    const errors = validateAgainstSchema(data, schema);
    results.push({ file: contextFile, status: errors.length === 0 ? 'valid' : 'invalid', errors });
  }

  return results;
}

export function registerValidateCommand(cli: CAC) {
  cli
    .command('validate [dir]', 'Validate .context/ files against JSON schemas')
    .action(async (dir: string = process.cwd()) => {
      const rootDir = dir;

      const contextDir = resolveContextDir(rootDir);

      // Check if .context exists
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }

      const results = await validateContextDir(contextDir);
      const totalFiles = results.filter(r => r.status !== 'skipped').length;
      const failedFiles = results.filter(r => r.status === 'invalid').length;
      const skippedFiles = results.filter(r => r.status === 'skipped').length;

      for (const r of results) {
        if (r.status === 'skipped') {
          logger.warn(`Skipped ${r.file} (file not found)`);
        } else if (r.status === 'valid') {
          logger.success(`${r.file} — valid`);
        } else {
          logger.error(`${r.file} — ${r.errors.length} error(s):`);
          for (const err of r.errors) {
            logger.info(`  ${err.path || '(root)'}: ${err.message}`);
          }
        }
      }

      // Summary
      console.log();
      if (failedFiles === 0 && totalFiles > 0) {
        logger.success(`All ${totalFiles} file(s) passed validation.`);
        if (skippedFiles > 0) {
          logger.info(`${skippedFiles} file(s) skipped (not found).`);
        }
      } else if (totalFiles === 0) {
        logger.warn('No .context/ files found to validate.');
        process.exit(1);
      } else {
        logger.error(`${failedFiles} of ${totalFiles} file(s) failed validation.`);
        if (skippedFiles > 0) {
          logger.info(`${skippedFiles} file(s) skipped (not found).`);
        }
        process.exit(1);
      }
    });
}
