import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { addDecision, listDecisions } from '../src/core/decisions.js';

describe('addDecision', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  });

  it('creates decisions.json with the adjective.us schema when absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-decisions-'));
    dirs.push(dir);
    const decision = await addDecision(dir, { title: 'Pick Vitest', rationale: 'Fast, ESM native' });
    expect(decision.status).toBe('accepted');

    const saved = JSON.parse(await readFile(join(dir, 'decisions.json'), 'utf-8'));
    expect(saved.$schema).toBe('https://adjective.us/prelude/schemas/v1/decisions.schema.json');
    expect(saved.decisions).toHaveLength(1);

    await addDecision(dir, { title: 'Second', rationale: 'Appends', tags: ['x'] });
    expect((await listDecisions(dir)).map(d => d.title)).toEqual(['Pick Vitest', 'Second']);
  });

  it('rejects a missing rationale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-decisions-'));
    dirs.push(dir);
    await expect(addDecision(dir, { title: 'x', rationale: ' ' })).rejects.toThrow('rationale');
  });
});
