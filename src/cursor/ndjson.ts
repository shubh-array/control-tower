
export interface NdjsonEvent {
  type: string;
  [key: string]: unknown;
}

export interface InitEvent {
  type: 'init';
  sessionId: string;
  model: string;
}

export interface AssistantEvent {
  type: 'assistant';
  content?: string;
  [key: string]: unknown;
}

export interface TerminalEvent {
  type: 'result';
  status: string;
  result: string;
  is_error?: boolean;
  timing: { durationMs: number };
  requestId: string;
  usage: { inputTokens: number; outputTokens: number };
}

export function parseNdjsonLine(line: string): NdjsonEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as NdjsonEvent;
  } catch {
    return null;
  }
}

export interface InitValidationResult {
  valid: boolean;
  error?: string;
  sessionId?: string;
  actualModel?: string;
}

export function validateInitEvent(
  init: InitEvent,
  expectedModel: string,
): InitValidationResult {
  if (!init.sessionId) {
    return { valid: false, error: 'missing sessionId in init event' };
  }

  if (init.model !== expectedModel) {
    return {
      valid: false,
      error: `model mismatch: expected '${expectedModel}', got '${init.model}'`,
      sessionId: init.sessionId,
      actualModel: init.model,
    };
  }

  return { valid: true, sessionId: init.sessionId, actualModel: init.model };
}

export interface ExtractedResult {
  success: boolean;
  text: string;
  timing?: { durationMs: number };
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export function extractResultFromTerminal(terminal: TerminalEvent): ExtractedResult {
  if (terminal.is_error || terminal.status === 'error') {
    return {
      success: false,
      text: terminal.result ?? '',
      timing: terminal.timing,
      usage: terminal.usage,
      error: `terminal status: ${terminal.status}`,
    };
  }

  return {
    success: true,
    text: terminal.result,
    timing: terminal.timing,
    usage: terminal.usage,
  };
}

export function parseNdjsonStream(raw: string): NdjsonEvent[] {
  return raw.split('\n')
    .map(parseNdjsonLine)
    .filter((e): e is NdjsonEvent => e !== null);
}
