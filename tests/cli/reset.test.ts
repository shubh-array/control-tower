import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReset } from "../../src/cli/reset.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `ct-reset-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runReset", () => {
  let tmp: string;
  let configPath: string;
  let dataDir: string;
  let profileDir: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    dataDir = join(tmp, "data");
    profileDir = join(tmp, "profile");
    configPath = join(tmp, "config.json");
    mkdirSync(join(dataDir, "jobs"), { recursive: true });
    writeFileSync(join(dataDir, "control-tower.sqlite"), "db");
    writeFileSync(join(dataDir, "daemon.pid"), "123");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "policy.json"), "{}");
    writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        profileDirectory: profileDir,
        dataDirectory: dataDir,
      }),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("aborts without --yes when confirm returns false", async () => {
    const result = await runReset({
      configPath,
      yes: false,
      confirm: async () => false,
    });
    expect(result.aborted).toBe(true);
    expect(existsSync(join(dataDir, "control-tower.sqlite"))).toBe(true);
  });

  it("wipes data only by default and keeps config/profile", async () => {
    let stopped = false;
    const result = await runReset({
      configPath,
      yes: true,
      stopDaemon: async () => {
        stopped = true;
        return "Daemon stopped (pid 123)";
      },
    });

    expect(result.aborted).toBe(false);
    expect(result.wipedData).toBe(true);
    expect(result.wipedConfig).toBe(false);
    expect(result.wipedProfile).toBe(false);
    expect(stopped).toBe(true);
    expect(existsSync(dataDir)).toBe(true);
    expect(existsSync(join(dataDir, "control-tower.sqlite"))).toBe(false);
    expect(existsSync(join(profileDir, "policy.json"))).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });

  it("wipes read-only sealed run directories", async () => {
    const sealed = join(dataDir, "jobs", "job-1", "runs", "run-1");
    mkdirSync(sealed, { recursive: true });
    writeFileSync(join(sealed, "run.json"), "{}");
    chmodSync(sealed, 0o555);
    chmodSync(join(dataDir, "jobs", "job-1", "runs"), 0o555);

    const result = await runReset({
      configPath,
      yes: true,
      stopDaemon: async () => "Daemon is not running",
    });

    expect(result.wipedData).toBe(true);
    expect(existsSync(join(dataDir, "jobs"))).toBe(false);
  });

  it("wipes config and profile with scope=all", async () => {
    const result = await runReset({
      configPath,
      scope: "all",
      yes: true,
      stopDaemon: async () => "Daemon is not running",
    });

    expect(result.wipedData).toBe(true);
    expect(result.wipedConfig).toBe(true);
    expect(result.wipedProfile).toBe(true);
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(profileDir)).toBe(false);
    expect(existsSync(dataDir)).toBe(true);
  });
});
