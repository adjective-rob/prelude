import { z } from 'zod';

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
  decisions: z.array(DecisionSchema)
});

export type Decision = z.infer<typeof DecisionSchema>;
export type Decisions = z.infer<typeof DecisionsSchema>;