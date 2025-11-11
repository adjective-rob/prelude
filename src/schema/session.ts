import { z } from 'zod';

export const SessionEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  type: z.enum(['prompt', 'decision', 'refactor', 'debug', 'planning', 'review']),
  summary: z.string(),
  input: z.string().optional(),
  output: z.string().optional(),
  filesAffected: z.array(z.string()).optional(),
  outcome: z.enum(['success', 'partial', 'failed', 'pending']).optional(),
  tags: z.array(z.string()).optional()
});

export const SessionSchema = z.object({
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  entries: z.array(SessionEntrySchema)
});

export const SessionsSchema = z.object({
  sessions: z.array(SessionSchema)
});

export type SessionEntry = z.infer<typeof SessionEntrySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Sessions = z.infer<typeof SessionsSchema>;