import { z } from 'zod';

export const ProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
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