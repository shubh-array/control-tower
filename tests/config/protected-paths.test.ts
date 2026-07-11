import { describe, it, expect } from "vitest";
import { buildProtectedPathMatcher } from "../../src/config/protected-paths.js";

describe("buildProtectedPathMatcher", () => {
  it("matches app-default protected paths", () => {
    const matcher = buildProtectedPathMatcher([]);

    expect(matcher.matches(".env")).toBe(true);
    expect(matcher.matches("certs/a.pem")).toBe(true);
    expect(matcher.matches("src/index.ts")).toBe(false);
  });

  it("includes org security protected paths", () => {
    const matcher = buildProtectedPathMatcher(["**/secrets/**"]);

    expect(matcher.matches("foo/secrets/x")).toBe(true);
  });
});
