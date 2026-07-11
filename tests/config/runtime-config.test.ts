// tests/config/runtime-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadRuntimeConfig,
  type RuntimeConfigHandle,
} from "../../src/config/runtime-config.js";

const VALID = {
  schemaVersion: 1,
  port: 9120,
  publication: { mode: "shadow" },
  profileId: "shubh",
};

describe("loadRuntimeConfig — last-valid retention", () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ct-runtime-cfg-"));
    configPath = join(tmp, "local.json");
    writeFileSync(configPath, JSON.stringify(VALID, null, 2));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads a valid config", () => {
    const handle = loadRuntimeConfig(configPath);
    expect(handle.current.port).toBe(9120);
    expect(handle.current.publication.mode).toBe("shadow");
    expect(handle.lastValid).toEqual(handle.current);
  });

  it("keeps lastValid on invalid reload and does not partially apply", () => {
    const handle: RuntimeConfigHandle = loadRuntimeConfig(configPath);
    expect(handle.current.publication.mode).toBe("shadow");

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          port: 9999,
          publication: { mode: "gated" },
          profileId: "shubh",
          unknownField: true,
        },
        null,
        2,
      ),
    );

    const reloaded = handle.reload();
    expect(reloaded.ok).toBe(false);
    expect(reloaded.error).toMatch(/invalid|unknown/i);

    expect(handle.current.port).toBe(9120);
    expect(handle.current.publication.mode).toBe("shadow");
    expect(handle.lastValid.port).toBe(9120);
    expect(handle.lastValid.publication.mode).toBe("shadow");

    const disk = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(disk.port).toBe(9999);
    expect(handle.current.port).not.toBe(disk.port);
  });

  it("updates lastValid only after a successful reload", () => {
    const handle = loadRuntimeConfig(configPath);

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          port: 9120,
          publication: { mode: "gated" },
          profileId: "shubh",
        },
        null,
        2,
      ),
    );

    const reloaded = handle.reload();
    expect(reloaded.ok).toBe(true);
    expect(handle.current.publication.mode).toBe("gated");
    expect(handle.lastValid.publication.mode).toBe("gated");
  });
});
