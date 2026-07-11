import { describe, it, expect } from 'vitest';
import {
  parseNdjsonLine,
  validateInitEvent,
  extractResultFromTerminal,
  type NdjsonEvent,
  type InitEvent,
  type TerminalEvent,
} from '../../src/cursor/ndjson.js';

describe('parseNdjsonLine', () => {
  it('parses valid JSON lines', () => {
    const event = parseNdjsonLine('{"type":"init","sessionId":"s1","model":"composer-2.5-fast"}');
    expect(event).not.toBeNull();
    expect(event!.type).toBe('init');
  });

  it('returns null for empty lines', () => {
    expect(parseNdjsonLine('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseNdjsonLine('{broken')).toBeNull();
  });

  it('ignores unknown event types gracefully', () => {
    const event = parseNdjsonLine('{"type":"future_unknown","data":"hello"}');
    expect(event).not.toBeNull();
    expect(event!.type).toBe('future_unknown');
  });
});

describe('validateInitEvent', () => {
  it('accepts matching model', () => {
    const init: InitEvent = { type: 'init', sessionId: 'sess-1', model: 'composer-2.5-fast' };
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(true);
  });

  it('CRITICAL: rejects model mismatch', () => {
    const init: InitEvent = { type: 'init', sessionId: 'sess-1', model: 'composer-2.5' };
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('model mismatch');
  });

  it('rejects missing session ID', () => {
    const init = { type: 'init', model: 'composer-2.5-fast' } as InitEvent;
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(false);
  });
});

describe('extractResultFromTerminal', () => {
  it('extracts result text from terminal event', () => {
    const terminal: TerminalEvent = {
      type: 'result',
      status: 'completed',
      result: '{"schemaVersion":1}',
      timing: { durationMs: 5000 },
      requestId: 'req-1',
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const result = extractResultFromTerminal(terminal);
    expect(result.text).toBe('{"schemaVersion":1}');
    expect(result.success).toBe(true);
  });

  it('detects is_error flag', () => {
    const terminal: TerminalEvent = {
      type: 'result',
      status: 'error',
      result: '',
      is_error: true,
      timing: { durationMs: 1000 },
      requestId: 'req-1',
      usage: { inputTokens: 10, outputTokens: 0 },
    };
    const result = extractResultFromTerminal(terminal);
    expect(result.success).toBe(false);
  });
});
