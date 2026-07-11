import { describe, it, expect } from "vitest";
import { pathMatchesAny } from "../../src/paths/match-patterns.js";

describe("pathMatchesAny", () => {
  it("matches when any pattern matches", () => {
    expect(pathMatchesAny("src/a.ts", ["lib/**", "src/**"])).toBe(true);
  });
  it("returns false when no pattern matches", () => {
    expect(pathMatchesAny("docs/a.md", ["src/**"])).toBe(false);
  });
  it("returns false for empty patterns", () => {
    expect(pathMatchesAny("src/a.ts", [])).toBe(false);
  });
  it("rejects invalid patterns rather than matching", () => {
    expect(pathMatchesAny("src/a.ts", ["***/x"])).toBe(false);
  });
});
