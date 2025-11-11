import { z } from 'zod';

export const ConstraintsSchema = z.object({
  mustUse: z.array(z.string()).optional(),
  mustNotUse: z.array(z.string()).optional(),
  preferences: z.array(z.object({
    category: z.string(),
    preference: z.string(),
    rationale: z.string().optional()
  })).optional(),
  codeStyle: z.object({
    formatter: z.string().optional(),
    linter: z.string().optional(),
    rules: z.array(z.string()).optional()
  }).optional(),
  naming: z.object({
    files: z.string().optional(),
    components: z.string().optional(),
    functions: z.string().optional(),
    variables: z.string().optional()
  }).optional(),
  fileOrganization: z.array(z.string()).optional(),
  testing: z.object({
    required: z.boolean().optional(),
    coverage: z.number().optional(),
    strategy: z.string().optional()
  }).optional(),
  documentation: z.object({
    required: z.boolean().optional(),
    style: z.string().optional()
  }).optional(),
  performance: z.array(z.string()).optional(),
  security: z.array(z.string()).optional(),
  accessibility: z.array(z.string()).optional()
});

export type Constraints = z.infer<typeof ConstraintsSchema>;