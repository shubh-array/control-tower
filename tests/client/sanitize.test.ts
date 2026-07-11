// tests/client/sanitize.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeSchema, isSafeUrl } from "../../client/src/lib/sanitize.js";

describe("sanitizeSchema", () => {
  it("allows basic text formatting tags", () => {
    expect(sanitizeSchema.tagNames).toContain("p");
    expect(sanitizeSchema.tagNames).toContain("strong");
    expect(sanitizeSchema.tagNames).toContain("em");
    expect(sanitizeSchema.tagNames).toContain("code");
    expect(sanitizeSchema.tagNames).toContain("pre");
    expect(sanitizeSchema.tagNames).toContain("blockquote");
  });

  it("allows list tags", () => {
    expect(sanitizeSchema.tagNames).toContain("ul");
    expect(sanitizeSchema.tagNames).toContain("ol");
    expect(sanitizeSchema.tagNames).toContain("li");
  });

  it("allows heading tags", () => {
    expect(sanitizeSchema.tagNames).toContain("h1");
    expect(sanitizeSchema.tagNames).toContain("h2");
    expect(sanitizeSchema.tagNames).toContain("h3");
  });

  it("allows anchor tags with href", () => {
    expect(sanitizeSchema.tagNames).toContain("a");
    expect(sanitizeSchema.attributes?.a).toContain("href");
  });

  it("disallows dangerous tags", () => {
    expect(sanitizeSchema.tagNames).not.toContain("script");
    expect(sanitizeSchema.tagNames).not.toContain("style");
    expect(sanitizeSchema.tagNames).not.toContain("iframe");
    expect(sanitizeSchema.tagNames).not.toContain("object");
    expect(sanitizeSchema.tagNames).not.toContain("embed");
    expect(sanitizeSchema.tagNames).not.toContain("form");
    expect(sanitizeSchema.tagNames).not.toContain("svg");
  });
});

describe("isSafeUrl", () => {
  it("allows https URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
  });

  it("allows mailto URLs", () => {
    expect(isSafeUrl("mailto:user@example.com")).toBe(true);
  });

  it("allows same-origin relative URLs", () => {
    expect(isSafeUrl("/api/health")).toBe(true);
  });

  it("allows fragment-only URLs", () => {
    expect(isSafeUrl("#section-1")).toBe(true);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects vbscript: URLs", () => {
    expect(isSafeUrl("vbscript:MsgBox")).toBe(false);
  });

  it("rejects javascript with mixed case", () => {
    expect(isSafeUrl("JaVaScRiPt:alert(1)")).toBe(false);
  });

  it("rejects javascript with leading whitespace", () => {
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
  });
});
