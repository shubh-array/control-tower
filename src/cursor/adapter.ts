import { spawn, type ChildProcess } from 'node:child_process';
import { buildCursorArgv, buildCursorEnvironment, type CursorArgvInput } from './argv.js';
import { parseNdjsonLine, validateInitEvent, extractResultFromTerminal, type InitEvent, type TerminalEvent, type NdjsonEvent } from './ndjson.js';

export const STREAM_TRUNCATE_BYTES = 10 * 1024 * 1024; // 10 MB

const ROLE_TIMEOUTS: Record<string, number> = {
  attention: 90_000,
  primaryReview: 20 * 60 * 1000,
};

export function getTimeoutForRole(role: string, overrideMs?: number): number {
  return overrideMs ?? ROLE_TIMEOUTS[role] ?? ROLE_TIMEOUTS.primaryReview;
}

export interface AdapterRunInput {
  role: 'attention' | 'primaryReview';
  binary: string;
  runDirectory: string;
  modelId: string;
  prompt: string;
  sourceViewPath?: string;
  homePath: string;
  timeoutMs?: number;
  transcriptPath: string;
  stderrPath: string;
}

export interface AdapterRunResult {
  success: boolean;
  sessionId?: string;
  actualModel?: string;
  resultText?: string;
  events: NdjsonEvent[];
  timing?: { durationMs: number };
  usage?: { inputTokens: number; outputTokens: number };
  exitCode: number | null;
  failureReason?: string;
}

export async function runCursorAgent(input: AdapterRunInput): Promise<AdapterRunResult> {
  const argv = buildCursorArgv({
    binary: input.binary,
    runDirectory: input.runDirectory,
    modelId: input.modelId,
    prompt: input.prompt,
    sourceViewPath: input.sourceViewPath,
  });

  const env = buildCursorEnvironment(input.homePath);
  const timeoutMs = getTimeoutForRole(input.role, input.timeoutMs);

  const child = spawn(argv[0], argv.slice(1), {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: input.runDirectory,
  });

  return await collectOutput(child, input.modelId, timeoutMs);
}

async function collectOutput(
  child: ChildProcess,
  expectedModel: string,
  timeoutMs: number,
): Promise<AdapterRunResult> {
  const events: NdjsonEvent[] = [];
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let initEvent: InitEvent | null = null;
  let terminalEvent: TerminalEvent | null = null;

  return new Promise<AdapterRunResult>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, timeoutMs);

    child.stdout!.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= STREAM_TRUNCATE_BYTES) return;
      stdoutBytes += chunk.length;
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseNdjsonLine(line);
        if (event) {
          events.push(event);
          if (event.type === 'init') initEvent = event as unknown as InitEvent;
          if (event.type === 'result') terminalEvent = event as unknown as TerminalEvent;
        }
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderrBytes < STREAM_TRUNCATE_BYTES) {
        stderrBytes += chunk.length;
        stderrBuffer += chunk.toString('utf-8');
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);

      if (stdoutBuffer.trim()) {
        const event = parseNdjsonLine(stdoutBuffer);
        if (event) {
          events.push(event);
          if (event.type === 'init') initEvent = event as unknown as InitEvent;
          if (event.type === 'result') terminalEvent = event as unknown as TerminalEvent;
        }
      }

      if (exitCode !== 0) {
        return resolve({
          success: false, events, exitCode,
          failureReason: `non-zero exit code: ${exitCode}`,
        });
      }

      if (!initEvent) {
        return resolve({
          success: false, events, exitCode,
          failureReason: 'no init event received',
        });
      }

      const initResult = validateInitEvent(initEvent, expectedModel);
      if (!initResult.valid) {
        return resolve({
          success: false, events, exitCode,
          sessionId: initResult.sessionId,
          actualModel: initResult.actualModel,
          failureReason: initResult.error,
        });
      }

      if (!terminalEvent) {
        return resolve({
          success: false, events, exitCode,
          sessionId: initResult.sessionId,
          failureReason: 'no terminal result event',
        });
      }

      const extracted = extractResultFromTerminal(terminalEvent);
      resolve({
        success: extracted.success,
        sessionId: initResult.sessionId,
        actualModel: initResult.actualModel,
        resultText: extracted.text,
        events,
        timing: extracted.timing,
        usage: extracted.usage,
        exitCode,
        failureReason: extracted.success ? undefined : extracted.error,
      });
    });
  });
}
