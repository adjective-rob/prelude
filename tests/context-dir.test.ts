import { describe, it, expect, afterEach } from 'vitest';
import { basename, join } from 'path';
import { resolveContextDir, isExternalBrainMode } from '../src/runtime/context.js';

describe('resolveContextDir', () => {
  const original = process.env.PRELUDE_ROOT;

  afterEach(() => {
    if (original === undefined) delete process.env.PRELUDE_ROOT;
    else process.env.PRELUDE_ROOT = original;
  });

  it('uses <root>/.context when PRELUDE_ROOT is unset', () => {
    delete process.env.PRELUDE_ROOT;
    expect(resolveContextDir('/tmp/foo')).toBe('/tmp/foo/.context');
    expect(isExternalBrainMode()).toBe(false);
  });

  it('uses <PRELUDE_ROOT>/<basename> in external brain mode', () => {
    process.env.PRELUDE_ROOT = '/tmp/brain';
    expect(resolveContextDir('/tmp/foo/')).toBe('/tmp/brain/foo');
    expect(isExternalBrainMode()).toBe(true);
  });

  it('resolves "." to the basename of cwd', () => {
    process.env.PRELUDE_ROOT = '/tmp/brain';
    expect(resolveContextDir('.')).toBe(join('/tmp/brain', basename(process.cwd())));
  });
});
