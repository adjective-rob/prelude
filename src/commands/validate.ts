import type { CAC } from 'cac';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJSON, fileExists } from '../utils/fs.js';
import { logger } from '../utils/log.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);



// Map context files to their schema files
const FILE_SCHEMA_MAP: Record<string, string> = {
  [CONTEXT_FILES.PROJECT]: 'project.schema.json',
  [CONTEXT_FILES.STACK]: 'stack.schema.json',
  [CONTEXT_FILES.ARCHITECTURE]: 'architecture.schema.json',
  [CONTEXT_FILES.CONSTRAINTS]: 'constraints.schema.json',
  [CONTEXT_FILES.DECISIONS]: 'decisions.schema.json',
};

interface ValidationError {
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

function validateAgainstSchema(
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

export function registerValidateCommand(cli: CAC) {
  cli
    .command('validate [dir]', 'Validate .context/ files against JSON schemas')
    .action(async (dir: string = process.cwd()) => {
      const rootDir = dir;

      const externalRoot = process.env.PRELUDE_ROOT;

      const contextDir = externalRoot
        ? join(externalRoot, rootDir.split('/').pop() as string)
        : join(rootDir, CONTEXT_DIR);

      // Check if .context exists
      if (!(await fileExists(contextDir))) {
        logger.error('.context/ directory not found. Run `prelude init` first.');
        process.exit(1);
      }

      const schemasDir = await getSchemasDir();

      let totalFiles = 0;
      let passedFiles = 0;
      let failedFiles = 0;
      let skippedFiles = 0;

      for (const [contextFile, schemaFile] of Object.entries(FILE_SCHEMA_MAP)) {
        const filePath = join(contextDir, contextFile);
        const schemaPath = join(schemasDir, schemaFile);

        // Skip files that don't exist
        if (!(await fileExists(filePath))) {
          skippedFiles++;
          logger.warn(`Skipped ${contextFile} (file not found)`);
          continue;
        }

        totalFiles++;

        // Load schema
        let schema: Record<string, unknown>;
        try {
          schema = await readJSON<Record<string, unknown>>(schemaPath);
        } catch {
          failedFiles++;
          logger.error(`Failed to load schema: ${schemaFile}`);
          continue;
        }

        // Load and parse context file
        let data: unknown;
        try {
          data = await readJSON<unknown>(filePath);
        } catch (error) {
          failedFiles++;
          logger.error(`${contextFile}: Invalid JSON — ${error}`);
          continue;
        }

        // Validate
        const errors = validateAgainstSchema(data, schema);

        if (errors.length === 0) {
          passedFiles++;
          logger.success(`${contextFile} — valid`);
        } else {
          failedFiles++;
          logger.error(`${contextFile} — ${errors.length} error(s):`);
          for (const err of errors) {
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
