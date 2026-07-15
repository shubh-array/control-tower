import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  OUTPUT_CONTRACT_TEXT,
  SAFETY_CONTRACT_TEXT,
} from "../../src/app-safety/contracts.js";
import { stripMdcFrontmatter } from "../../src/app-safety/pr-review-plugin.js";
import {
  resolveControlTowerCursorHome,
  ensureControlTowerCursorHome,
} from "../../src/cursor/cursor-home.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const pluginRules = join(
  process.cwd(),
  "config/plugins/control-tower-pr-review/rules",
);

describe("control-tower-pr-review plugin contract parity", () => {
  it("safety-contract.mdc body matches SAFETY_CONTRACT_TEXT", () => {
    const raw = readFileSync(join(pluginRules, "safety-contract.mdc"), "utf-8");
    expect(stripMdcFrontmatter(raw)).toBe(SAFETY_CONTRACT_TEXT);
  });

  it("output-contract.mdc body matches OUTPUT_CONTRACT_TEXT", () => {
    const raw = readFileSync(join(pluginRules, "output-contract.mdc"), "utf-8");
    expect(stripMdcFrontmatter(raw)).toBe(OUTPUT_CONTRACT_TEXT);
  });
});

describe("resolveControlTowerCursorHome", () => {
  it("defaults to dataDirectory/cursor-home", () => {
    expect(resolveControlTowerCursorHome("/data/ct")).toBe(
      "/data/ct/cursor-home",
    );
  });

  it("honors CONTROL_TOWER_CURSOR_HOME", () => {
    expect(
      resolveControlTowerCursorHome("/data/ct", {
        env: { CONTROL_TOWER_CURSOR_HOME: "/custom/cursor-home" },
      }),
    ).toBe("/custom/cursor-home");
  });

  it("ensureControlTowerCursorHome creates the directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ct-home-"));
    const home = join(root, "cursor-home");
    try {
      ensureControlTowerCursorHome(home);
      expect(existsSync(home)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
