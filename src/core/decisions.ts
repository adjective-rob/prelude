import { join } from 'path';
import { readJSON, writeJSON, fileExists } from '../utils/fs.js';
import { getCurrentTimestamp, generateId } from '../utils/time.js';
import { CONTEXT_FILES } from '../constants.js';
import type { Decision, Decisions } from '../schema/index.js';

const SCHEMA_URL = 'https://adjective.us/prelude/schemas/v1';
const DECISIONS_VERSION = '1.0.0';

export interface DecisionInput {
  title: string;
  rationale: string;
  alternatives?: string[];
  impact?: string;
  author?: string;
  tags?: string[];
  status?: Decision['status'];
}

async function readDecisions(contextDir: string): Promise<Decisions> {
  const path = join(contextDir, CONTEXT_FILES.DECISIONS);
  if (await fileExists(path)) {
    const existing = await readJSON<Decisions>(path);
    if (existing && Array.isArray(existing.decisions)) return existing;
  }
  return {
    $schema: `${SCHEMA_URL}/decisions.schema.json`,
    version: DECISIONS_VERSION,
    decisions: [],
  };
}

/** Append a decision to decisions.json, creating the file if needed. */
export async function addDecision(contextDir: string, input: DecisionInput): Promise<Decision> {
  if (!input.title?.trim()) throw new Error('Decision title is required');
  if (!input.rationale?.trim()) throw new Error('Decision rationale is required');

  const decisions = await readDecisions(contextDir);
  const decision: Decision = {
    id: generateId(),
    timestamp: getCurrentTimestamp(),
    title: input.title.trim(),
    status: input.status ?? 'accepted',
    rationale: input.rationale.trim(),
  };
  if (input.alternatives?.length) decision.alternatives = input.alternatives;
  if (input.impact) decision.impact = input.impact;
  if (input.author) decision.author = input.author;
  if (input.tags?.length) decision.tags = input.tags;

  decisions.decisions.push(decision);
  await writeJSON(join(contextDir, CONTEXT_FILES.DECISIONS), decisions);
  return decision;
}

export async function listDecisions(contextDir: string): Promise<Decision[]> {
  return (await readDecisions(contextDir)).decisions;
}
