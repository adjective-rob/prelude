import { z } from 'zod';
import { RelatedProjectSchema } from './project.js';

const WORKSPACE_VERSION = "1.0.0";
const SCHEMA_URL = "https://adjective.us/prelude/schemas/v1";

/**
 * The workspace is a user-level, machine-local registry of projects
 * (~/.prelude/workspace.json) plus a generated index over their context
 * (~/.prelude/index.json). Neither file is committed to any repository.
 */

export const WorkspaceProjectSchema = z.object({
  name: z.string(),
  path: z.string(),                 // absolute
  alias: z.string().optional(),
  addedAt: z.string().datetime(),
});

export const WorkspaceSchema = z.object({
  $schema: z.string().default(`${SCHEMA_URL}/workspace.schema.json`),
  version: z.string().default(WORKSPACE_VERSION),
  projects: z.array(WorkspaceProjectSchema),
});

export const IndexedProjectSchema = z.object({
  name: z.string(),
  alias: z.string().optional(),
  path: z.string(),
  contextDir: z.string(),
  description: z.string().optional(),
  type: z.string().optional(),            // architecture.type
  language: z.string().optional(),
  frameworks: z.array(z.string()).optional(),
  packageName: z.string().optional(),
  entryPoints: z.array(z.object({ file: z.string(), purpose: z.string() })).optional(),
  apiEndpoints: z.array(z.object({ path: z.string(), methods: z.array(z.string()), file: z.string() })).optional(), // first 40
  apiEndpointCount: z.number().optional(),
  apiPrefix: z.object({ prefix: z.string(), count: z.number() }).optional(), // dominant route prefix
  hubs: z.array(z.object({ file: z.string(), importedBy: z.number() })).optional(), // first 5
  modules: z.array(z.object({ path: z.string(), purpose: z.string().optional() })).optional(), // all, purpose only
  relatedProjects: z.array(RelatedProjectSchema).optional(),
  decisionCount: z.number().optional(),
  lastContextUpdate: z.string().optional(), // project.updatedAt
  hasMap: z.boolean(),
  missing: z.boolean().optional(),          // path or context dir no longer exists
});

export const WorkspaceIndexSchema = z.object({
  $schema: z.string().default(`${SCHEMA_URL}/workspace-index.schema.json`),
  version: z.string().default(WORKSPACE_VERSION),
  generatedAt: z.string().datetime(),
  projects: z.array(IndexedProjectSchema),
});

export type WorkspaceProject = z.infer<typeof WorkspaceProjectSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type IndexedProject = z.infer<typeof IndexedProjectSchema>;
export type WorkspaceIndex = z.infer<typeof WorkspaceIndexSchema>;
