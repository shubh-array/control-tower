import { readFileSync } from "node:fs";

export interface RuntimeConfig {
  schemaVersion: number;
  port: number;
  publication: { mode: "shadow" | "gated" };
  profileId: string;
}

export interface ReloadResult {
  ok: boolean;
  error?: string;
}

export interface RuntimeConfigHandle {
  /** Currently active (always a previously validated config). */
  readonly current: RuntimeConfig;
  /** Same as current after success; retained across failed reloads. */
  readonly lastValid: RuntimeConfig;
  reload: () => ReloadResult;
}

function parseAndValidate(raw: string): RuntimeConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "port", "publication", "profileId"]);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid runtime config: unknown key "${key}"`);
    }
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error("Invalid runtime config: schemaVersion must be 1");
  }
  if (typeof parsed.port !== "number" || parsed.port !== 9120) {
    throw new Error("Invalid runtime config: port must be 9120");
  }
  const publication = parsed.publication as { mode?: string } | undefined;
  if (
    !publication ||
    (publication.mode !== "shadow" && publication.mode !== "gated")
  ) {
    throw new Error("Invalid runtime config: publication.mode must be shadow|gated");
  }
  if (typeof parsed.profileId !== "string" || parsed.profileId.length === 0) {
    throw new Error("Invalid runtime config: profileId required");
  }
  return {
    schemaVersion: 1,
    port: 9120,
    publication: { mode: publication.mode },
    profileId: parsed.profileId,
  };
}

export function loadRuntimeConfig(configPath: string): RuntimeConfigHandle {
  const initial = parseAndValidate(readFileSync(configPath, "utf-8"));
  let current: RuntimeConfig = initial;
  let lastValid: RuntimeConfig = initial;

  return {
    get current() {
      return current;
    },
    get lastValid() {
      return lastValid;
    },
    reload(): ReloadResult {
      try {
        const next = parseAndValidate(readFileSync(configPath, "utf-8"));
        current = next;
        lastValid = next;
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export interface LocalConfig {
  schemaVersion: number;
  profileId?: string;
  [key: string]: unknown;
}

export interface RuntimeConfigDeps {
  readFile: () => string;
  log: (message: string) => void;
}

export class RuntimeConfigLoader {
  private lastValid: LocalConfig | null = null;

  constructor(private readonly deps: RuntimeConfigDeps) {}

  load(): LocalConfig {
    try {
      const raw = this.deps.readFile();
      const parsed = JSON.parse(raw) as LocalConfig;
      this.lastValid = parsed;
      return parsed;
    } catch (err) {
      if (this.lastValid) {
        this.deps.log(
          `Config reload failed (${err instanceof Error ? err.message : String(err)}), retaining last-valid config`,
        );
        return this.lastValid;
      }
      throw new Error(
        `Initial config load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
