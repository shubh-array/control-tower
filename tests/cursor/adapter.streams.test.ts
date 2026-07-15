import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAdapterStreams } from '../../src/cursor/adapter.js';
import { buildCursorEnvironment } from '../../src/cursor/argv.js';

describe('writeAdapterStreams', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ct-adapter-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes stdout and stderr to configured paths', () => {
    const transcriptPath = join(dir, 'transcript.ndjson');
    const stderrPath = join(dir, 'stderr.log');

    writeAdapterStreams(
      transcriptPath,
      stderrPath,
      '{"type":"init"}\n{"type":"result"}',
      'warning: deprecated flag\n',
    );

    expect(readFileSync(transcriptPath, 'utf-8')).toBe('{"type":"init"}\n{"type":"result"}');
    expect(readFileSync(stderrPath, 'utf-8')).toBe('warning: deprecated flag\n');
  });
});

describe('buildCursorEnvironment', () => {
  it('delegates to buildCursorEnv with HOME override and optional CURSOR_API_KEY', () => {
    const saved = {
      PATH: process.env.PATH,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      USER: process.env.USER,
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    };

    process.env.PATH = '/usr/bin';
    process.env.LANG = 'en_US.UTF-8';
    process.env.LC_ALL = 'en_US.UTF-8';
    process.env.USER = 'tester';
    process.env.CURSOR_API_KEY = 'secret';

    try {
      const env = buildCursorEnvironment('/custom/home');
      expect(env.HOME).toBe('/custom/home');
      expect(env.PATH).toBe('/usr/bin');
      expect(env.LANG).toBe('en_US.UTF-8');
      expect(env.LC_ALL).toBe('en_US.UTF-8');
      expect(env.USER).toBe('tester');
      expect(env.CURSOR_API_KEY).toBe('secret');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
