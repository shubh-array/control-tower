// tests/config/last-valid.test.ts
import { describe, it, expect, vi } from "vitest";
import { RuntimeConfigLoader } from "../../src/config/runtime-config.js";

describe("RuntimeConfigLoader", () => {
  it("returns parsed config when valid", () => {
    const loader = new RuntimeConfigLoader({
      readFile: () =>
        JSON.stringify({ schemaVersion: 1, profileId: "test" }),
      log: vi.fn(),
    });

    const config = loader.load();

    expect(config.profileId).toBe("test");
    expect(config.schemaVersion).toBe(1);
  });

  it("retains last-valid config on invalid reload", () => {
    let callCount = 0;
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "original" });
        return "{ invalid json !!!";
      },
      log: vi.fn(),
    });

    const first = loader.load();
    expect(first.profileId).toBe("original");

    const second = loader.load();
    expect(second.profileId).toBe("original");
  });

  it("logs warning on invalid reload", () => {
    let callCount = 0;
    const log = vi.fn();
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "valid" });
        return "!!!";
      },
      log,
    });

    loader.load();
    loader.load();

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/failed|invalid|retain/i),
    );
  });

  it("throws on first load if config is invalid (no last-valid to fall back to)", () => {
    const loader = new RuntimeConfigLoader({
      readFile: () => "not json",
      log: vi.fn(),
    });

    expect(() => loader.load()).toThrow(/initial config load failed/i);
  });

  it("retains last-valid through multiple consecutive invalid reloads", () => {
    let callCount = 0;
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "keeper" });
        return "invalid";
      },
      log: vi.fn(),
    });

    loader.load();
    loader.load();
    const third = loader.load();

    expect(third.profileId).toBe("keeper");
  });

  it("updates last-valid when a subsequent reload is valid", () => {
    let callCount = 0;
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "v1" });
        if (callCount === 2) return "broken";
        return JSON.stringify({ schemaVersion: 1, profileId: "v2" });
      },
      log: vi.fn(),
    });

    expect(loader.load().profileId).toBe("v1");
    expect(loader.load().profileId).toBe("v1");
    expect(loader.load().profileId).toBe("v2");
  });
});
