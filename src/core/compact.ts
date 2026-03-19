import { exportCompact as exportCompactFull } from './query-engine.js';

export async function exportCompact(
  rootDir: string,
  options: { topic?: string; scope?: string; maxTokens?: number }
): Promise<string> {
  const { output } = await exportCompactFull(rootDir, options);
  return output;
}
