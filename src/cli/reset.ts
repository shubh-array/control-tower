import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type ResetScope = "data" | "all";

export interface ResetOptions {
  configPath?: string;
  scope?: ResetScope;
  yes?: boolean;
  stopDaemon?: (dataDirectory: string) => Promise<string>;
  confirm?: (message: string) => Promise<boolean>;
  log?: (message: string) => void;
}

export interface ResetResult {
  stoppedDaemon: boolean;
  wipedData: boolean;
  wipedConfig: boolean;
  wipedProfile: boolean;
  dataDirectory: string | null;
  profileDirectory: string | null;
  configPath: string;
  aborted: boolean;
}

function defaultConfigPath(): string {
  return (
    process.env.CONTROL_TOWER_CONFIG ??
    join(homedir(), ".control-tower", "config.json")
  );
}

function readPaths(configPath: string): {
  dataDirectory: string;
  profileDirectory: string;
} | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      dataDirectory?: string;
      profileDirectory?: string;
    };
    if (!config.dataDirectory || !config.profileDirectory) {
      return null;
    }
    const expand = (p: string): string => {
      if (p === "~") return homedir();
      if (p.startsWith("~/")) return `${homedir()}${p.slice(1)}`;
      return p;
    };
    return {
      dataDirectory: expand(config.dataDirectory),
      profileDirectory: expand(config.profileDirectory),
    };
  } catch {
    return null;
  }
}

function makeTreeWritable(root: string): void {
  if (!existsSync(root)) {
    return;
  }

  // Never follow symlinks: chmod on macOS follows targets, and recursion
  // into a link under data/ could mutate paths outside the data tree
  // (e.g. a Keychains link into ~/Library/Keychains).
  try {
    if (lstatSync(root).isSymbolicLink()) {
      return;
    }
  } catch {
    return;
  }

  try {
    chmodSync(root, 0o755);
  } catch {
    // Best-effort; deletion may still succeed.
  }

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    try {
      chmodSync(full, entry.isDirectory() ? 0o755 : 0o644);
    } catch {
      // Best-effort.
    }
    if (entry.isDirectory()) {
      makeTreeWritable(full);
    }
  }
}

function wipeDirectory(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  // If the configured root is itself a symlink, only remove the link —
  // do not chmod/recurse into the target.
  try {
    if (lstatSync(path).isSymbolicLink()) {
      rmSync(path, { force: true });
      return;
    }
  } catch {
    // Fall through to best-effort wipe.
  }

  // Sealed run dirs are often mode 0555; unlock before recursive delete.
  makeTreeWritable(path);

  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code !== "ENOTEMPTY" && code !== "EBUSY") {
        throw error;
      }
      makeTreeWritable(path);
    }
  }
  throw lastError;
}

export async function runReset(opts: ResetOptions = {}): Promise<ResetResult> {
  const configPath = opts.configPath ?? defaultConfigPath();
  const scope: ResetScope = opts.scope ?? "data";
  const log = opts.log ?? (() => {});

  const paths = readPaths(configPath);
  const fallbackBase = join(homedir(), ".control-tower");
  const dataDirectory = paths?.dataDirectory ?? join(fallbackBase, "data");
  const profileDirectory =
    paths?.profileDirectory ?? join(fallbackBase, "profile");

  const targets =
    scope === "all"
      ? [
          `data: ${dataDirectory}`,
          `profile: ${profileDirectory}`,
          `config: ${configPath}`,
        ]
      : [`data: ${dataDirectory}`];

  const confirmMessage =
    scope === "all"
      ? `Reset ALL local Control Tower state?\n  - ${targets.join("\n  - ")}\nRepo harnesses/prompts/skills are kept. Continue? [y/N]`
      : `Reset Control Tower data only?\n  - ${targets.join("\n  - ")}\nConfig and profile are kept. Continue? [y/N]`;

  if (!opts.yes) {
    const confirmed = opts.confirm
      ? await opts.confirm(confirmMessage)
      : false;
    if (!confirmed) {
      log("Reset cancelled.");
      return {
        stoppedDaemon: false,
        wipedData: false,
        wipedConfig: false,
        wipedProfile: false,
        dataDirectory,
        profileDirectory,
        configPath,
        aborted: true,
      };
    }
  }

  let stoppedDaemon = false;
  if (opts.stopDaemon && existsSync(dataDirectory)) {
    const msg = await opts.stopDaemon(dataDirectory);
    stoppedDaemon = !msg.toLowerCase().includes("not running");
    log(msg);
  }

  wipeDirectory(dataDirectory);
  mkdirSync(dataDirectory, { recursive: true });
  log(`Wiped data directory: ${dataDirectory}`);

  let wipedConfig = false;
  let wipedProfile = false;

  if (scope === "all") {
    wipeDirectory(profileDirectory);
    wipedProfile = true;
    log(`Wiped profile directory: ${profileDirectory}`);

    if (existsSync(configPath)) {
      rmSync(configPath, { force: true });
      wipedConfig = true;
      log(`Removed config: ${configPath}`);
    }

    const configDir = dirname(configPath);
    if (existsSync(configDir)) {
      // Leave parent dir; init recreates files inside it.
    }

    log("Run `pnpm ct init` to recreate config and profile.");
  }

  return {
    stoppedDaemon,
    wipedData: true,
    wipedConfig,
    wipedProfile,
    dataDirectory,
    profileDirectory,
    configPath,
    aborted: false,
  };
}
