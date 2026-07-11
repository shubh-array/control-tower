import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { openDatabase } from "../store/db.js";
import { runMigrations } from "../store/migrate.js";
import { startRuntime, stopRuntime } from "../daemon/runtime.js";
import { createBootstrap } from "../daemon/bootstrap.js";

const DEFAULT_PORT = 9120;

let activeHandle: Awaited<ReturnType<typeof startRuntime>> | null = null;

function pidFilePath(dataDir: string): string {
  return join(dataDir, "daemon.pid");
}

function resolveAppRoot(): string {
  return resolve(join(import.meta.dirname, "../.."));
}

function resolveLocalConfigPath(): string {
  return (
    process.env.CONTROL_TOWER_CONFIG ??
    join(homedir(), ".control-tower", "config.json")
  );
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
  db.close();

  const localConfigPath = resolveLocalConfigPath();
  const { config, deps } = createBootstrap({
    appRoot: resolveAppRoot(),
    localConfigPath,
  });

  const daemonPort = port ?? config.port ?? DEFAULT_PORT;
  config.port = daemonPort;

  activeHandle = await startRuntime(config, deps);
  writeFileSync(pidFile, String(process.pid));

  return `Control Tower started at ${activeHandle.url} (pid ${process.pid})`;
}

export async function stopCommand(dataDir: string): Promise<string> {
  const pidFile = pidFilePath(dataDir);
  if (!existsSync(pidFile)) {
    return "Daemon is not running";
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);

  if (activeHandle) {
    await stopRuntime(activeHandle);
    activeHandle = null;
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
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
