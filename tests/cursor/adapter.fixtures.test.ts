import { describe, it, expect } from 'vitest';
import { buildCursorArgv, type CursorArgvInput } from '../../src/cursor/argv.js';
import {
  getTimeoutForRole,
  STREAM_TRUNCATE_BYTES,
} from '../../src/cursor/adapter.js';

describe('adapter argv fixtures', () => {
  const baseInput: CursorArgvInput = {
    binary: 'agent',
    runDirectory: '/data/jobs/j1/runs/r1',
    modelId: 'composer-2.5-fast',
    prompt: 'Review this PR',
  };

  it('produces correct base argv for primaryReview', () => {
    const argv = buildCursorArgv(baseInput);
    expect(argv).toContain('--mode=ask');
    expect(argv).toContain('--sandbox');
    expect(argv).toContain('enabled');
    expect(argv).toContain('--trust');
    expect(argv).toContain('--output-format');
    expect(argv).toContain('stream-json');
    expect(argv).toContain('--print');
    expect(argv[argv.length - 1]).toBe('Review this PR');
  });

  it('adds --add-dir for registered-source primaryReview', () => {
    const argv = buildCursorArgv({
      ...baseInput,
      sourceViewPath: '/data/worktrees/j1/source',
    });
    const addDirIdx = argv.indexOf('--add-dir');
    expect(addDirIdx).toBeGreaterThan(-1);
    expect(argv[addDirIdx + 1]).toBe('/data/worktrees/j1/source');
  });

  it('omits --add-dir for remote-evidence-only', () => {
    const argv = buildCursorArgv({
      ...baseInput,
      sourceViewPath: undefined,
    });
    expect(argv).not.toContain('--add-dir');
  });
});

describe('adapter timeout configuration', () => {
  it('returns 20 minutes for primaryReview role', () => {
    expect(getTimeoutForRole('primaryReview')).toBe(20 * 60 * 1000);
  });

  it('honors explicit timeout overrides', () => {
    expect(getTimeoutForRole('primaryReview', 30_000)).toBe(30_000);
  });
});

describe('stream truncation', () => {
  it('enforces 10 MB limit', () => {
    expect(STREAM_TRUNCATE_BYTES).toBe(10 * 1024 * 1024);
  });
});
