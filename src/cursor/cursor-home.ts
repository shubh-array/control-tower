import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve the Cursor Agent HOME used by Control Tower review sessions.
 * Prefer an isolated directory under the data root so operator ~/.cursor
 * skills/plugins do not leak into sealed primaryReview runs.
 */
export function resolveControlTowerCursorHome(
  dataDirectory: string,
  overrides?: {
    cursorHomePath?: string;
    env?: Record<string, string | undefined>;
  },
): string {
  const env = overrides?.env ?? process.env;
  const explicit =
    overrides?.cursorHomePath ??
    env.CONTROL_TOWER_CURSOR_HOME;
  if (explicit && explicit.trim() !== "") {
    return explicit;
  }
  if (dataDirectory && dataDirectory.trim() !== "") {
    return join(dataDirectory, "cursor-home");
  }
  return env.HOME ?? homedir();
}

export function ensureControlTowerCursorHome(homePath: string): string {
  mkdirSync(homePath, { recursive: true });
  return homePath;
}
