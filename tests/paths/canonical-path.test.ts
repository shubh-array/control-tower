import { describe, it, expect } from "vitest";
import { validateCanonicalPath } from "../../src/paths/canonical-path.js";

describe("validateCanonicalPath", () => {
  const valid = (p: string) => {
    const r = validateCanonicalPath(p);
    expect(r.valid, `expected valid: ${p}, got: ${r.valid ? "" : r.reason}`).toBe(true);
  };
  const invalid = (p: string, reason?: string) => {
    const r = validateCanonicalPath(p);
    expect(r.valid, `expected invalid: ${p}`).toBe(false);
    if (!r.valid && reason) {
      expect(r.reason).toContain(reason);
    }
  };

  it("accepts simple relative paths", () => {
    valid("src/index.ts");
    valid("README.md");
    valid("a/b/c/d.txt");
  });

  it("accepts dotfiles", () => {
    valid(".env");
    valid(".gitignore");
    valid("src/.hidden/file.ts");
  });

  it("accepts Unicode NFC paths", () => {
    valid("src/caf\u00E9.ts");
  });

  it("rejects absolute paths", () => {
    invalid("/src/index.ts", "absolute");
  });

  it("rejects leading slash", () => {
    invalid("/foo", "absolute");
  });

  it("rejects trailing slash", () => {
    invalid("src/", "trailing");
  });

  it("rejects backslash", () => {
    invalid("src\\file.ts", "backslash");
  });

  it("rejects empty string", () => {
    invalid("", "empty");
  });

  it("rejects empty segments", () => {
    invalid("src//file.ts", "empty segment");
  });

  it("rejects . segment", () => {
    invalid("src/./file.ts", "dot segment");
  });

  it("rejects .. segment", () => {
    invalid("src/../file.ts", "dot segment");
  });

  it("rejects case-insensitive .git segment", () => {
    invalid("src/.git/config", ".git");
    invalid("src/.GIT/config", ".git");
    invalid("src/.Git/config", ".git");
    invalid(".git/HEAD", ".git");
  });

  it("rejects NUL character", () => {
    invalid("src/file\0.ts", "control");
  });

  it("rejects control characters", () => {
    invalid("src/file\x01.ts", "control");
    invalid("src/file\x7f.ts", "control");
  });

  it("rejects non-NFC Unicode", () => {
    invalid("src/cafe\u0301.ts", "NFC");
  });

  it("strips diff a/ and b/ prefixes", () => {
    const r = validateCanonicalPath("a/src/file.ts", { stripDiffPrefix: true });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.path).toBe("src/file.ts");

    const r2 = validateCanonicalPath("b/src/file.ts", { stripDiffPrefix: true });
    expect(r2.valid).toBe(true);
    if (r2.valid) expect(r2.path).toBe("src/file.ts");
  });

  it("does not strip a/ b/ when option is off", () => {
    const r = validateCanonicalPath("a/src/file.ts");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.path).toBe("a/src/file.ts");
  });
});
