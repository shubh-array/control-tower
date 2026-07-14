
export interface NdjsonEvent {
  type: string;
  [key: string]: unknown;
}

export interface InitEvent {
  type: 'init';
  sessionId: string;
  model: string;
}

/**
 * Newer Cursor agent versions emit { type: "system", subtype: "init" }
 * instead of { type: "init" }. Normalize to our InitEvent shape.
 */
export function isInitEvent(event: NdjsonEvent): boolean {
  if (event.type === 'init') return true;
  return event.type === 'system' && event.subtype === 'init';
}

export function toInitEvent(event: NdjsonEvent): InitEvent {
  return {
    type: 'init',
    sessionId: (event.sessionId ?? event.session_id ?? '') as string,
    model: (event.model ?? '') as string,
  };
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

function normalizeModelName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '-');
}

export function validateInitEvent(
  init: InitEvent,
  expectedModel: string,
): InitValidationResult {
  if (!init.sessionId) {
    return { valid: false, error: 'missing sessionId in init event' };
  }

  if (normalizeModelName(init.model) !== normalizeModelName(expectedModel)) {
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

/**
 * Agent result may be bare JSON or prose wrapping a markdown-fenced JSON block.
 * Extract the JSON either way.
 */
export function extractJsonFromResult(text: string): string | null {
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Look for ```json ... ``` or ``` ... ```
    const match = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (match) {
      const inner = match[1]!.trim();
      try {
        JSON.parse(inner);
        return inner;
      } catch {
        // fall through
      }
    }
    // Agent may prefix JSON with prose explanation
    const braceStart = trimmed.indexOf("{");
    const braceEnd = trimmed.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      const candidate = trimmed.slice(braceStart, braceEnd + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return null;
      }
    }
    return null;
  }
}
