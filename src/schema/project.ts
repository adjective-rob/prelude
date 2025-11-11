import { z } from 'zod';

const PRELUDE_VERSION = "1.0.0";
const SCHEMA_URL = "https://adjective.us/prelude/schemas/v1";

export const ProjectSchema = z.object({
  $schema: z.string().url().default(`${SCHEMA_URL}/project.json`),
  version: z.string().default(PRELUDE_VERSION), // This is the SCHEMA version
  name: z.string(),
  description: z.string(),
  projectVersion: z.string().optional(), // <-- RENAMED from 'version'
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  repository: z.string().url().optional(),
  team: z.array(z.object({
    name: z.string(),
    role: z.string().optional(),
    email: z.string().email().optional()
  })).optional(),
  outputs: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional()
});

export type Project = z.infer<typeof ProjectSchema>;