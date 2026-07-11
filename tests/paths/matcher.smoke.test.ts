import { describe, expect, it } from "vitest";
import { CanonicalPathMatcher } from "../../src/paths/matcher.js";

function matcher(pattern: string): CanonicalPathMatcher {
  return CanonicalPathMatcher.compile([{ pattern, source: "smoke" }]);
}

describe("CanonicalPathMatcher smoke", () => {
  it("matches simple globs and hashes content", () => {
    expect(matcher("*.pem").matches("server.pem")).toBe(true);
    expect(matcher("*.pem").matches("certs/server.pem")).toBe(false);
    expect(matcher("src/**").matches("src/a.ts")).toBe(true);

    expect(() => matcher("***")).toThrow();
    expect(matcher("*.pem").contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
