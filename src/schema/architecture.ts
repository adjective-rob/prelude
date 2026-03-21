import { z } from 'zod';

const PRELUDE_VERSION = "1.0.0";
const SCHEMA_URL = "https://adjective.us/prelude/schemas/v1";

export const ArchitectureSchema = z.object({
  $schema: z.string().url().default(`${SCHEMA_URL}/architecture.json`),
  version: z.string().default(PRELUDE_VERSION),
  type: z.enum(['monolith', 'monorepo', 'microservices', 'library', 'cli', 'fullstack', 'backend', 'frontend']).optional(),
  directories: z.array(z.object({
    path: z.string(),
    purpose: z.string().optional(),
    fileCount: z.number().optional()
  })),
  patterns: z.array(z.string()).optional(),
  conventions: z.array(z.string()).optional(),
  entryPoints: z.array(z.object({
    file: z.string(),
    purpose: z.string()
  })).optional(),
  routing: z.enum(['file-based', 'config-based', 'none']).optional(),
  stateManagement: z.string().optional(),
  apiStyle: z.enum(['REST', 'GraphQL', 'tRPC', 'gRPC', 'mixed', 'none']).optional(),
  dataFlow: z.string().optional(),

  // Source-level findings (inferred from actual code, not just config)
  reactPatterns: z.object({
    serverComponents: z.array(z.string()).optional(),
    clientComponents: z.array(z.string()).optional(),
    serverActions: z.array(z.string()).optional(),
    hooks: z.array(z.object({
      file: z.string(),
      hooks: z.array(z.string())
    })).optional(),
    providers: z.array(z.object({
      file: z.string(),
      name: z.string(),
      contextName: z.string().optional()
    })).optional(),
    layouts: z.array(z.string()).optional()
  }).optional(),

  routes: z.array(z.object({
    file: z.string(),
    path: z.string(),
    methods: z.array(z.string()).optional(),
    isDynamic: z.boolean()
  })).optional(),

  middleware: z.array(z.object({
    file: z.string(),
    type: z.string(),
    guards: z.array(z.string()).optional()
  })).optional(),

  apiEndpoints: z.array(z.object({
    file: z.string(),
    path: z.string(),
    methods: z.array(z.string())
  })).optional(),

  keyFiles: z.array(z.object({
    file: z.string(),
    role: z.string()
  })).optional(),

  importPatterns: z.object({
    internalAliases: z.array(z.string()).optional(),
    heavyImporters: z.array(z.string()).optional()
  }).optional()
});

export type Architecture = z.infer<typeof ArchitectureSchema>;