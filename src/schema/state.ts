import { z } from 'zod';

/**
 * Tracks which fields are inferred vs manually edited
 * Stored in .context/.prelude/state.json
 */

export const FieldStateSchema = z.object({
  value: z.any(), // The actual value
  source: z.enum(['inferred', 'manual', 'merged']),
  lastInferred: z.string().datetime().optional(), // When it was last inferred
  lastModified: z.string().datetime().optional(), // When user last edited
  inferredHash: z.string().optional(), // Hash of last inferred value
});

export const FileStateSchema = z.object({
  file: z.string(), // e.g., "project.json"
  lastUpdated: z.string().datetime(),
  fields: z.record(z.string(), FieldStateSchema), // field path -> state
});

export const PreludeStateSchema = z.object({
  version: z.string().default('1.0.0'),
  initialized: z.string().datetime(),
  lastUpdate: z.string().datetime(),
  files: z.array(FileStateSchema),
});

export type FieldState = z.infer<typeof FieldStateSchema>;
export type FileState = z.infer<typeof FileStateSchema>;
export type PreludeState = z.infer<typeof PreludeStateSchema>;

/**
 * Helper to create initial state
 */
export function createInitialState(): PreludeState {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    initialized: now,
    lastUpdate: now,
    files: [],
  };
}

/**
 * Helper to track a field
 */
export function trackField(
  value: any,
  source: 'inferred' | 'manual' | 'merged',
  inferredHash?: string
): FieldState {
  const now = new Date().toISOString();
  return {
    value,
    source,
    lastInferred: source === 'inferred' ? now : undefined,
    lastModified: source === 'manual' ? now : undefined,
    inferredHash,
  };
}