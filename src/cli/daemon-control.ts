import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createDaemon, startDaemon } from "../daemon/server.js";
import { openDatabase } from "../store/db.js";
import { runMigrations } from "../store/migrate.js";

const DEFAULT_PORT = 9120;

function pidFilePath(dataDir: string): string {
  return join(dataDir, "daemon.pid");
}

export async function startCommand(dataDir: string, port?: number): Promise<string> {
  const pidFile = pidFilePath(dataDir);
  if (existsSync(pidFile)) {
    const existingPid = readFileSync(pidFile, "utf-8").trim();
    try {
      process.kill(parseInt(existingPid, 10), 0);
      return `Daemon already running (pid ${existingPid})`;
    } catch {
      unlinkSync(pidFile);
    }
  }

  const dbPath = join(dataDir, "control-tower.sqlite");
  const db = openDatabase(dbPath);
  runMigrations(db);

  const daemonPort = port ?? DEFAULT_PORT;
  const server = createDaemon({ port: daemonPort });
  const { url } = await startDaemon(server, { port: daemonPort });

  writeFileSync(pidFile, String(process.pid));

  return `Control Tower started at ${url} (pid ${process.pid})`;
}

export async function stopCommand(dataDir: string): Promise<string> {
  const pidFile = pidFilePath(dataDir);
  if (!existsSync(pidFile)) {
    return "Daemon is not running";
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already stopped.
  }
  unlinkSync(pidFile);
  return `Daemon stopped (pid ${pid})`;
}

export function statusCommand(dataDir: string): string {
  const pidFile = pidFilePath(dataDir);
  if (!existsSync(pidFile)) {
    return "Daemon is not running";
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0);
    return `Daemon is running (pid ${pid})`;
  } catch {
    unlinkSync(pidFile);
    return "Daemon is not running (stale pid file removed)";
  }
}
