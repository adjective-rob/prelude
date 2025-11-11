import { z } from 'zod';

export const StackSchema = z.object({
  language: z.string(),
  runtime: z.string().optional(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'poetry', 'cargo', 'go']).optional(),
  framework: z.string().optional(),
  frameworks: z.array(z.string()).optional(),
  dependencies: z.record(z.string()).optional(),
  devDependencies: z.record(z.string()).optional(),
  buildTools: z.array(z.string()).optional(),
  testingFrameworks: z.array(z.string()).optional(),
  styling: z.array(z.string()).optional(),
  database: z.string().optional(),
  orm: z.string().optional(),
  stateManagement: z.string().optional(),
  deployment: z.string().optional(),
  cicd: z.array(z.string()).optional()
});

export type Stack = z.infer<typeof StackSchema>;