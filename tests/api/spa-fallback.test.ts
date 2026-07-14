import { describe, expect, it } from "vitest";
import { shouldServeSpaFallback } from "../../src/api/spa-fallback.js";

describe("shouldServeSpaFallback", () => {
  it("allows client routes such as review deep links", () => {
    expect(shouldServeSpaFallback("/review/job-123")).toBe(true);
    expect(shouldServeSpaFallback("/inbox")).toBe(true);
  });

  it("rejects removed client routes", () => {
    expect(shouldServeSpaFallback("/propose")).toBe(false);
  });

  it("rejects API paths", () => {
    expect(shouldServeSpaFallback("/api")).toBe(false);
    expect(shouldServeSpaFallback("/api/health")).toBe(false);
    expect(shouldServeSpaFallback("/api/queue")).toBe(false);
  });

  it("rejects missing static asset requests", () => {
    expect(shouldServeSpaFallback("/assets/index-abc123.js")).toBe(false);
    expect(shouldServeSpaFallback("/assets/index-abc123.css")).toBe(false);
    expect(shouldServeSpaFallback("/assets/file.mjs")).toBe(false);
    expect(shouldServeSpaFallback("/missing.html")).toBe(false);
    expect(shouldServeSpaFallback("/favicon.ico")).toBe(false);
  });
});
