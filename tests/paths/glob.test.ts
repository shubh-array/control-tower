import { describe, it, expect } from "vitest";
import { validateGlob, deduplicateGlobs } from "../../src/paths/glob.js";

describe("validateGlob", () => {
  const valid = (pattern: string) => {
    const r = validateGlob(pattern);
    expect(r.valid, `expected valid: ${pattern}, got: ${r.valid ? "" : r.reason}`).toBe(true);
    return r;
  };
  const invalid = (pattern: string, reason?: string) => {
    const r = validateGlob(pattern);
    expect(r.valid, `expected invalid: ${pattern}`).toBe(false);
    if (!r.valid && reason) {
      expect(r.reason).toContain(reason);
    }
    return r;
  };

  it("accepts literal segments", () => {
    const r = valid("src/index.ts");
    if (r.valid) {
      expect(r.pattern).toBe("src/index.ts");
      expect(r.segments).toEqual([
        { type: "literal", value: "src" },
        { type: "literal", value: "index.ts" },
      ]);
    }
  });

  it("accepts * wildcard segment", () => {
    const r = valid("src/*");
    if (r.valid) {
      expect(r.segments).toEqual([
        { type: "literal", value: "src" },
        { type: "wildcard", value: "*" },
      ]);
    }
  });

  it("accepts ? wildcard segment", () => {
    const r = valid("file?.ts");
    if (r.valid) {
      expect(r.segments).toEqual([{ type: "wildcard", value: "file?.ts" }]);
    }
  });

  it("accepts ** as whole segment", () => {
    const r = valid("**");
    if (r.valid) {
      expect(r.segments).toEqual([{ type: "globstar" }]);
    }

    const r2 = valid("src/**/file.ts");
    if (r2.valid) {
      expect(r2.segments).toEqual([
        { type: "literal", value: "src" },
        { type: "globstar" },
        { type: "literal", value: "file.ts" },
      ]);
    }
  });

  it("accepts mixed wildcard patterns", () => {
    const r = valid("src/*.ts");
    if (r.valid) {
      expect(r.segments).toEqual([
        { type: "literal", value: "src" },
        { type: "wildcard", value: "*.ts" },
      ]);
    }

    const r2 = valid("**/*.pem");
    if (r2.valid) {
      expect(r2.segments).toEqual([
        { type: "globstar" },
        { type: "wildcard", value: "*.pem" },
      ]);
    }
  });

  it("rejects empty pattern", () => {
    invalid("", "empty pattern");
  });

  it("rejects leading slash", () => {
    invalid("/src/*.ts", "leading or trailing slash");
  });

  it("rejects trailing slash", () => {
    invalid("src/", "leading or trailing slash");
  });

  it("rejects backslash", () => {
    invalid("src\\*.ts", "backslash");
  });

  it("rejects control characters", () => {
    invalid("src/file\0.ts", "control");
    invalid("src/file\x01.ts", "control");
    invalid("src/file\x7f.ts", "control");
  });

  it("rejects non-NFC Unicode", () => {
    invalid("src/cafe\u0301.ts", "NFC");
  });

  it("rejects ***", () => {
    invalid("src/***/file.ts", "***");
  });

  it("rejects character classes, braces, and extglob chars", () => {
    invalid("src/[a].ts", "character classes");
    invalid("src/{a,b}.ts", "character classes");
    invalid("src/(a|b).ts", "character classes");
    invalid("src/!(a).ts", "character classes");
    invalid("src/@(a).ts", "character classes");
    invalid("src/+(a).ts", "character classes");
  });

  it("rejects ** embedded in segment", () => {
    invalid("a**b", "** must be an entire segment");
    invalid("src/a**b/file.ts", "** must be an entire segment");
  });

  it("rejects empty segments", () => {
    invalid("src//file.ts", "empty segment");
  });

  it("rejects dot segments", () => {
    invalid("src/./file.ts", "dot segment");
    invalid("src/../file.ts", "dot segment");
  });
});

describe("deduplicateGlobs", () => {
  it("returns unique patterns and duplicates", () => {
    const result = deduplicateGlobs([
      "src/*.ts",
      "docs/*.md",
      "src/*.ts",
      "tests/**/*.ts",
      "docs/*.md",
    ]);

    expect(result.unique).toEqual(["src/*.ts", "docs/*.md", "tests/**/*.ts"]);
    expect(result.duplicates).toEqual(["src/*.ts", "docs/*.md"]);
  });

  it("returns empty arrays for empty input", () => {
    expect(deduplicateGlobs([])).toEqual({ unique: [], duplicates: [] });
  });
});
