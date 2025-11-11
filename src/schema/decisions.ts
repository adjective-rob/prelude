import { z } from 'zod';

const PRELUDE_VERSION = "1.0.0";
const SCHEMA_URL = "https://adjective.us/prelude/schemas/v1";

export const DecisionSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  title: z.string(),
  status: z.enum(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']),
  rationale: z.string(),
  alternatives: z.array(z.string()).optional(),
  consequences: z.array(z.string()).optional(),
  impact: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  supersededBy: z.string().optional()
});

export const DecisionsSchema = z.object({
  $schema: z.string().url().default(`${SCHEMA_URL}/decisions.json`),
  version: z.string().default(PRELUDE_VERSION),
  decisions: z.array(DecisionSchema)
});

export type Decision = z.infer<typeof DecisionSchema>;
export type Decisions = z.infer<typeof DecisionsSchema>;