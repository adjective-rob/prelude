import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

let cached: string | undefined;

/**
 * The package version from package.json. Works from source (src/utils or
 * bin, via tsx/vitest) and from the build (dist/src/utils or dist/bin).
 */
export function getPackageVersion(): string {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../package.json', '../../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), 'utf-8'));
      if (pkg?.name === 'prelude-context' && typeof pkg.version === 'string') {
        cached = pkg.version as string;
        return cached;
      }
    } catch {
      // try the next location
    }
  }
  cached = '0.0.0';
  return cached;
}
