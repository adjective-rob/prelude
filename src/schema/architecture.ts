import { z } from 'zod';

export const ArchitectureSchema = z.object({
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
  dataFlow: z.string().optional()
});

export type Architecture = z.infer<typeof ArchitectureSchema>;