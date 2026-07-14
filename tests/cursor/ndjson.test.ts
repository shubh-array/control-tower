import { describe, it, expect } from 'vitest';
import {
  parseNdjsonLine,
  validateInitEvent,
  extractResultFromTerminal,
  isInitEvent,
  toInitEvent,
  extractJsonFromResult,
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

describe('isInitEvent + toInitEvent', () => {
  it('recognizes legacy type:init', () => {
    const event = { type: 'init', sessionId: 'sess-1', model: 'composer-2.5-fast' };
    expect(isInitEvent(event)).toBe(true);
    const init = toInitEvent(event);
    expect(init.sessionId).toBe('sess-1');
    expect(init.model).toBe('composer-2.5-fast');
  });

  it('recognizes new type:system subtype:init with session_id', () => {
    const event = { type: 'system', subtype: 'init', session_id: 'sess-2', model: 'Composer 2.5 Fast' };
    expect(isInitEvent(event)).toBe(true);
    const init = toInitEvent(event);
    expect(init.sessionId).toBe('sess-2');
    expect(init.model).toBe('Composer 2.5 Fast');
  });

  it('does not match type:system without subtype:init', () => {
    const event = { type: 'system', subtype: 'config', model: 'x' };
    expect(isInitEvent(event)).toBe(false);
  });
});

describe('validateInitEvent', () => {
  it('accepts matching model', () => {
    const init: InitEvent = { type: 'init', sessionId: 'sess-1', model: 'composer-2.5-fast' };
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(true);
  });

  it('accepts display name vs slug with different casing', () => {
    const init: InitEvent = { type: 'init', sessionId: 'sess-1', model: 'Composer 2.5 Fast' };
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(true);
  });

  it('CRITICAL: rejects actual model mismatch', () => {
    const init: InitEvent = { type: 'init', sessionId: 'sess-1', model: 'gpt-4o' };
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

describe('extractJsonFromResult', () => {
  it('returns bare JSON directly', () => {
    const raw = '{"schemaVersion":1,"summary":{"intent":"fix bug"}}';
    expect(extractJsonFromResult(raw)).toBe(raw);
  });

  it('extracts JSON from markdown-fenced block', () => {
    const json = '{"schemaVersion":1}';
    const raw = `I'll review the PR.\n\n\`\`\`json\n${json}\n\`\`\``;
    expect(extractJsonFromResult(raw)).toBe(json);
  });

  it('extracts JSON from fence without language tag', () => {
    const json = '{"schemaVersion":1}';
    const raw = `Here is the output:\n\n\`\`\`\n${json}\n\`\`\``;
    expect(extractJsonFromResult(raw)).toBe(json);
  });

  it('extracts JSON prefixed with prose explanation', () => {
    const json = '{"schemaVersion":1,"summary":{"intent":"fix bug"}}';
    const raw = `I'll locate the PR diff and review schema first.\n${json}`;
    expect(extractJsonFromResult(raw)).toBe(json);
  });

  it('returns null for prose with unbalanced braces', () => {
    expect(extractJsonFromResult('Here is { some text } that is not JSON')).toBeNull();
  });

  it('returns null for non-JSON non-fenced text', () => {
    expect(extractJsonFromResult('hello world')).toBeNull();
  });

  it('returns null for fenced invalid JSON', () => {
    const raw = '```json\n{broken\n```';
    expect(extractJsonFromResult(raw)).toBeNull();
  });
});
