import { z } from 'zod';

const MAP_VERSION = "1.0.0";
const SCHEMA_URL = "https://adjective.us/prelude/schemas/v1";

export const MapLangSchema = z.enum(['ts', 'js', 'py', 'go', 'rs']);

export const MapFileSchema = z.object({
  file: z.string(),
  lang: MapLangSchema,
  lines: z.number(),
  exports: z.array(z.string()).optional(),
  imports: z.array(z.string()).optional(),
  importedBy: z.number().optional(),
  rank: z.number().optional(),
  role: z.string().optional(),
  isTest: z.boolean().optional(),
});

export const MapModuleSchema = z.object({
  path: z.string(),
  purpose: z.string().optional(),
  notes: z.string().optional(),
  fileCount: z.number(),
  truncated: z.boolean().optional(),
  files: z.array(MapFileSchema),
  dependsOn: z.array(z.string()).optional(),
  dependedOnBy: z.array(z.string()).optional(),
  tests: z.array(z.string()).optional(),
});

export const MapHubSchema = z.object({
  file: z.string(),
  importedBy: z.number(),
  rank: z.number(),
  exports: z.array(z.string()).optional(),
});

export const MapSchema = z.object({
  $schema: z.string().default(`${SCHEMA_URL}/map.schema.json`),
  version: z.string().default(MAP_VERSION),
  stats: z.object({
    files: z.number(),
    modules: z.number(),
    edges: z.number(),
    unresolvedImports: z.number(),
    truncated: z.boolean().optional(),
  }),
  modules: z.array(MapModuleSchema),
  hubs: z.array(MapHubSchema).optional(),
});

export type MapLang = z.infer<typeof MapLangSchema>;
export type MapFile = z.infer<typeof MapFileSchema>;
export type MapModule = z.infer<typeof MapModuleSchema>;
export type MapHub = z.infer<typeof MapHubSchema>;
export type CodeMap = z.infer<typeof MapSchema>;
