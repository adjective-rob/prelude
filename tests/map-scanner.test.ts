import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { buildMap, type CodeMap, type MapFile } from '../src/core/map-scanner.js';
import { inferDirectoryPurpose } from '../src/core/vocab.js';

const tempDirs: string[] = [];

async function fixture(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'prelude-map-'));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

function findFile(map: CodeMap, file: string): MapFile | undefined {
  for (const mod of map.modules) {
    const hit = mod.files.find(f => f.file === file);
    if (hit) return hit;
  }
  return undefined;
}

function findModule(map: CodeMap, path: string) {
  return map.modules.find(m => m.path === path);
}

afterAll(async () => {
  await Promise.all(tempDirs.map(d => rm(d, { recursive: true, force: true })));
});

const TS_FIXTURE = {
  'tsconfig.json': `{
    // comments are allowed
    "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }
  }`,
  'src/index.ts': `import { alpha } from './core/a.js';\nimport { helper } from '@/utils/x.js';\nexport function main() { return alpha() + helper(); }\n`,
  'src/core/a.ts': [
    `import { helper } from '../utils/x.js';`,
    `export function alpha() { return helper(); }`,
    `export const beta = 1;`,
    `const gamma = 2;`,
    `export { gamma as delta };`,
    `// export function commented() {}`,
    '',
  ].join('\n'),
  'src/utils/x.ts': `export function helper() { return 1; }\n`,
  'tests/a.test.ts': `import { alpha } from '../src/core/a.js';\nalpha();\n`,
};

describe('buildMap — TypeScript', () => {
  it('extracts exports, resolves relative and alias imports, ranks hubs', async () => {
    const dir = await fixture(TS_FIXTURE);
    const map = await buildMap(dir);

    expect(findFile(map, 'src/core/a.ts')?.exports).toEqual(['alpha', 'beta', 'delta']);

    const x = findFile(map, 'src/utils/x.ts');
    expect(x?.importedBy).toBe(2);
    expect(x?.rank).toBe(1);
    expect(map.hubs?.[0].file).toBe('src/utils/x.ts');

    expect(findFile(map, 'src/index.ts')?.imports).toEqual(['src/core/a.ts', 'src/utils/x.ts']);

    const core = findModule(map, 'src/core');
    expect(core?.dependsOn).toEqual(['src/utils']);
    expect(core?.tests).toEqual(['tests/a.test.ts']);

    const testFile = findModule(map, 'tests')?.files[0];
    expect(testFile?.isTest).toBe(true);

    // Test imports do not count toward importedBy
    expect(findFile(map, 'src/core/a.ts')?.importedBy).toBe(1);
    expect(map.stats.unresolvedImports).toBe(0);
  });

  it('tags roles and bumps rank from architecture entry points', async () => {
    const dir = await fixture(TS_FIXTURE);
    const map = await buildMap(dir, {
      architecture: {
        $schema: '', version: '1', directories: [],
        entryPoints: [{ file: 'src/index.ts', purpose: 'Main entry' }],
      },
    });
    const idx = findFile(map, 'src/index.ts');
    expect(idx?.role).toBe('Main entry');
    expect(idx?.rank).toBe(0.5);
  });
});

describe('buildMap — Python', () => {
  it('resolves absolute and relative imports and filters private exports', async () => {
    const dir = await fixture({
      'app/__init__.py': '',
      'app/main.py': 'import os\nfrom app.routers import billing\nfrom .db import engine\n',
      'app/routers/__init__.py': '',
      'app/routers/billing.py': '"""\ndef not_real():\n"""\ndef checkout():\n    pass\n\nclass _Private:\n    pass\n',
      'app/db.py': 'engine = None\n',
    });
    const map = await buildMap(dir);
    expect(findFile(map, 'app/main.py')?.imports).toEqual(['app/db.py', 'app/routers/billing.py']);
    expect(findFile(map, 'app/routers/billing.py')?.exports).toEqual(['checkout']);
    expect(map.stats.unresolvedImports).toBe(0);
  });

  it('uses __all__ when present', async () => {
    const dir = await fixture({
      'pkg/__init__.py': '__all__ = ["_hidden", "shown"]\ndef shown(): pass\ndef _hidden(): pass\ndef other(): pass\n',
    });
    const map = await buildMap(dir);
    expect(findFile(map, 'pkg/__init__.py')?.exports).toEqual(['_hidden', 'shown']);
  });
});

describe('buildMap — Go', () => {
  it('resolves module imports to package directories', async () => {
    const dir = await fixture({
      'go.mod': 'module example.com/svc\n\ngo 1.22\n',
      'main.go': 'package main\n\nimport (\n\t"fmt"\n\t"example.com/svc/internal/api"\n)\n\nfunc main() { fmt.Println(api.Serve()) }\n',
      'internal/api/handler.go': 'package api\n\nfunc Serve() string { return helper() }\n\nfunc helper() string { return "" }\n',
    });
    const map = await buildMap(dir);
    expect(findFile(map, 'main.go')?.imports).toEqual(['internal/api/']);
    expect(findFile(map, 'internal/api/handler.go')?.exports).toEqual(['Serve']);
    expect(findModule(map, '.')?.dependsOn).toEqual(['internal/api']);
    // Directory targets do not create file in-degree
    expect(findFile(map, 'internal/api/handler.go')?.importedBy).toBeUndefined();
  });
});

describe('buildMap — Rust', () => {
  it('resolves mod declarations and crate paths', async () => {
    const dir = await fixture({
      'Cargo.toml': '[package]\nname = "x"\n',
      'src/main.rs': 'mod util;\nuse crate::util::run;\n\nfn main() { run(); }\n',
      'src/util.rs': 'pub fn run() {}\nfn private() {}\n',
    });
    const map = await buildMap(dir);
    expect(findFile(map, 'src/main.rs')?.imports).toEqual(['src/util.rs']);
    expect(findFile(map, 'src/util.rs')?.exports).toEqual(['run']);
  });
});

describe('buildMap — limits', () => {
  it('skips binary files and oversized files, and truncates at maxFiles', async () => {
    const dir = await fixture({
      'a.ts': 'export const a = 1;\n',
      'b.ts': Buffer.from([0x65, 0x78, 0x00, 0x70]),
      'c.ts': 'export const c = "' + 'x'.repeat(2000) + '";\n',
    });
    const map = await buildMap(dir, { maxFileBytes: 1000 });
    const files = map.modules.flatMap(m => m.files.map(f => f.file));
    expect(files).toEqual(['a.ts']);

    const capped = await buildMap(dir, { maxFiles: 2 });
    expect(capped.stats.truncated).toBe(true);
  });
});

describe('inferDirectoryPurpose', () => {
  it('matches on the last segment only', () => {
    expect(inferDirectoryPurpose('src/core')).toBe('Core business logic');
    expect(inferDirectoryPurpose('src/app/utils')).toBe('Utility functions');
    expect(inferDirectoryPurpose('src/zzz')).toBeUndefined();
    expect(inferDirectoryPurpose('app/api_routers')).toBe('Route definitions');
  });
});

describe('buildMap — determinism', () => {
  it('produces identical output across runs', async () => {
    const dir = await fixture(TS_FIXTURE);
    const a = await buildMap(dir);
    const b = await buildMap(dir);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('buildMap — this repo', () => {
  it('finds the expected hubs and module structure', async () => {
    const map = await buildMap(process.cwd());
    const hubFiles = map.hubs?.map(h => h.file) ?? [];
    expect(hubFiles).toContain('src/utils/fs.ts');
    expect(hubFiles).toContain('src/constants.ts');

    const core = findModule(map, 'src/core');
    expect(core?.purpose).toBe('Core business logic');
    expect(core?.dependsOn).toEqual(expect.arrayContaining(['src/utils', 'src/schema']));
    expect(core?.tests).toContain('tests/query.test.ts');
    expect(findModule(map, 'tests')?.files.some(f => f.isTest)).toBe(true);
  });
});
