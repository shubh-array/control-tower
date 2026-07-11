import { spawn } from "node:child_process";
import { buildGhEnv } from "../security/child-env.js";

export interface GhExecOptions {
  host: string;
  timeoutMs?: number;
}

export interface GhExecResult {
  stdout: string;
  exitCode: number;
}

export class GhProcessError extends Error {
  constructor(
    public readonly args: string[],
    public readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "GhProcessError";
  }
}

function spawnGh(
  args: string[],
  options: GhExecOptions,
): ReturnType<typeof spawn> {
  const env = buildGhEnv(process.env as Record<string, string | undefined>, {
    host: options.host,
  });

  const proc = spawn("gh", args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stderr.on("data", () => {
    // Discard stderr chunks to avoid pipe stall without retaining content.
  });

  return proc;
}

export async function execGh(
  args: string[],
  options: GhExecOptions,
): Promise<GhExecResult> {
  return new Promise<GhExecResult>((resolve, reject) => {
    const proc = spawnGh(args, options);

    const stdoutStream = proc.stdout;
    if (!stdoutStream) {
      reject(new Error("gh stdout stream unavailable"));
      return;
    }

    let output = "";
    stdoutStream.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        proc.kill("SIGTERM");
      }, options.timeoutMs);
    }

    proc.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ stdout: output, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(err);
    });
  });
}

export async function execGhStdoutStream(
  args: string[],
  options: GhExecOptions,
  onStdoutChunk: (chunk: string) => void,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const proc = spawnGh(args, options);

    const stdoutStream = proc.stdout;
    if (!stdoutStream) {
      reject(new Error("gh stdout stream unavailable"));
      return;
    }

    stdoutStream.on("data", (chunk: Buffer) => {
      onStdoutChunk(chunk.toString("utf-8"));
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        proc.kill("SIGTERM");
      }, options.timeoutMs);
    }

    proc.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve(code ?? 1);
    });

    proc.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(err);
    });
  });
}

export async function execGhJson<T>(
  args: string[],
  options: GhExecOptions,
): Promise<T> {
  const result = await execGh(args, options);
  if (result.exitCode !== 0) {
    throw new GhProcessError(
      args,
      result.exitCode,
      `gh exited with code ${result.exitCode}`,
    );
  }
  return JSON.parse(result.stdout) as T;
}

export async function execGhText(
  args: string[],
  options: GhExecOptions,
): Promise<string> {
  const result = await execGh(args, options);
  if (result.exitCode !== 0) {
    throw new GhProcessError(
      args,
      result.exitCode,
      `gh exited with code ${result.exitCode}`,
    );
  }
  return result.stdout.trim();
}
