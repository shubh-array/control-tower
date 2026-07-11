import { describe, it, expect } from "vitest";
import { CanonicalPathMatcher } from "../../src/paths/matcher.js";

function matcher(...patterns: string[]): CanonicalPathMatcher {
  return CanonicalPathMatcher.compile(
    patterns.map((p) => ({ pattern: p, source: "test" })),
  );
}

describe("CanonicalPathMatcher", () => {
  describe("root anchoring", () => {
    it("*.pem matches only root-level .pem files", () => {
      const m = matcher("*.pem");
      expect(m.matches("server.pem")).toBe(true);
      expect(m.matches("certs/server.pem")).toBe(false);
      expect(m.matches("a/b/server.pem")).toBe(false);
    });

    it("**/*.pem matches .pem files at any depth", () => {
      const m = matcher("**/*.pem");
      expect(m.matches("server.pem")).toBe(true);
      expect(m.matches("certs/server.pem")).toBe(true);
      expect(m.matches("a/b/c/server.pem")).toBe(true);
    });

    it("src/** matches src and all descendants", () => {
      const m = matcher("src/**");
      expect(m.matches("src")).toBe(true);
      expect(m.matches("src/index.ts")).toBe(true);
      expect(m.matches("src/a/b/c.ts")).toBe(true);
      expect(m.matches("lib/index.ts")).toBe(false);
    });

    it("literal path is root-anchored", () => {
      const m = matcher("README.md");
      expect(m.matches("README.md")).toBe(true);
      expect(m.matches("docs/README.md")).toBe(false);
    });

    it("src/index.ts is exact root-anchored match", () => {
      const m = matcher("src/index.ts");
      expect(m.matches("src/index.ts")).toBe(true);
      expect(m.matches("lib/src/index.ts")).toBe(false);
    });
  });

  describe("case sensitivity", () => {
    it("matches are case-sensitive", () => {
      const m = matcher("src/**");
      expect(m.matches("src/file.ts")).toBe(true);
      expect(m.matches("Src/file.ts")).toBe(false);
      expect(m.matches("SRC/file.ts")).toBe(false);
    });

    it("*.PEM does not match .pem", () => {
      const m = matcher("*.PEM");
      expect(m.matches("server.PEM")).toBe(true);
      expect(m.matches("server.pem")).toBe(false);
    });
  });

  describe("NFC normalization", () => {
    it("accepts NFC paths", () => {
      const m = matcher("src/**");
      expect(m.matches("src/caf\u00E9.ts")).toBe(true);
    });

    it("rejects non-NFC paths", () => {
      const m = matcher("src/**");
      expect(m.matches("src/cafe\u0301.ts")).toBe(false);
    });
  });

  describe("* wildcard (single segment)", () => {
    it("* matches any single root segment", () => {
      const m = matcher("*");
      expect(m.matches("README.md")).toBe(true);
      expect(m.matches("src")).toBe(true);
      expect(m.matches("a/b")).toBe(false);
    });

    it("*.ts matches root .ts files", () => {
      const m = matcher("*.ts");
      expect(m.matches("index.ts")).toBe(true);
      expect(m.matches("src/index.ts")).toBe(false);
    });

    it("src/*.ts matches direct children only", () => {
      const m = matcher("src/*.ts");
      expect(m.matches("src/index.ts")).toBe(true);
      expect(m.matches("src/lib/index.ts")).toBe(false);
    });

    it("* matches leading dots", () => {
      const m = matcher("*");
      expect(m.matches(".env")).toBe(true);
      expect(m.matches(".gitignore")).toBe(true);
    });
  });

  describe("? wildcard (single character)", () => {
    it("?.ts matches single-char .ts files", () => {
      const m = matcher("?.ts");
      expect(m.matches("a.ts")).toBe(true);
      expect(m.matches("ab.ts")).toBe(false);
    });

    it("? does not match /", () => {
      const m = matcher("?");
      expect(m.matches("a")).toBe(true);
      expect(m.matches("a/b")).toBe(false);
    });
  });

  describe("** (globstar — whole segment)", () => {
    it("** matches everything", () => {
      const m = matcher("**");
      expect(m.matches("a")).toBe(true);
      expect(m.matches("a/b")).toBe(true);
      expect(m.matches("a/b/c/d")).toBe(true);
    });

    it("**/.env matches .env at any depth", () => {
      const m = matcher("**/.env");
      expect(m.matches(".env")).toBe(true);
      expect(m.matches("a/.env")).toBe(true);
      expect(m.matches("a/b/.env")).toBe(true);
    });

    it("**/.env.* matches .env.* at any depth", () => {
      const m = matcher("**/.env.*");
      expect(m.matches(".env.local")).toBe(true);
      expect(m.matches("a/.env.production")).toBe(true);
      expect(m.matches("a/b/.env.test")).toBe(true);
      expect(m.matches(".env")).toBe(false);
    });

    it("a/**/z matches a/z and a/.../z", () => {
      const m = matcher("a/**/z");
      expect(m.matches("a/z")).toBe(true);
      expect(m.matches("a/b/z")).toBe(true);
      expect(m.matches("a/b/c/z")).toBe(true);
      expect(m.matches("z")).toBe(false);
      expect(m.matches("b/a/z")).toBe(false);
    });
  });

  describe("protected path defaults", () => {
    it("matches all spec-defined sensitive patterns", () => {
      const protectedDefaults = [
        "**/.env",
        "**/.env.*",
        "**/.cursor/mcp.json",
        "**/appsettings.secrets.json",
        "**/appsettings.Local.json",
        "**/*.pem",
        "**/*.key",
        "**/*.pfx",
        "**/deploy.*.parameters.json",
        "**/deploy.*.parameters.jsonc",
      ];
      const m = CanonicalPathMatcher.compile(
        protectedDefaults.map((p) => ({ pattern: p, source: "app-defaults" })),
      );

      expect(m.matches(".env")).toBe(true);
      expect(m.matches("config/.env")).toBe(true);
      expect(m.matches(".env.local")).toBe(true);
      expect(m.matches("deep/nested/.env.production")).toBe(true);
      expect(m.matches(".cursor/mcp.json")).toBe(true);
      expect(m.matches("project/.cursor/mcp.json")).toBe(true);
      expect(m.matches("appsettings.secrets.json")).toBe(true);
      expect(m.matches("src/appsettings.Local.json")).toBe(true);
      expect(m.matches("certs/server.pem")).toBe(true);
      expect(m.matches("deep/tls.key")).toBe(true);
      expect(m.matches("cert.pfx")).toBe(true);
      expect(m.matches("deploy.staging.parameters.json")).toBe(true);
      expect(m.matches("infra/deploy.prod.parameters.jsonc")).toBe(true);

      expect(m.matches("src/index.ts")).toBe(false);
      expect(m.matches("README.md")).toBe(false);
      expect(m.matches(".envrc")).toBe(false);
    });
  });

  describe("unsafe paths rejected", () => {
    it("rejects absolute paths", () => {
      const m = matcher("src/**");
      expect(m.matches("/src/file.ts")).toBe(false);
    });

    it("rejects paths with backslash", () => {
      const m = matcher("src/**");
      expect(m.matches("src\\file.ts")).toBe(false);
    });

    it("rejects paths with .. segments", () => {
      const m = matcher("src/**");
      expect(m.matches("src/../etc/passwd")).toBe(false);
    });

    it("rejects paths with empty segments", () => {
      const m = matcher("src/**");
      expect(m.matches("src//file.ts")).toBe(false);
    });

    it("rejects paths with .git segment", () => {
      const m = matcher("**");
      expect(m.matches(".git/config")).toBe(false);
      expect(m.matches("repo/.git/HEAD")).toBe(false);
    });
  });

  describe("unsupported syntax", () => {
    it("rejects *** in pattern", () => {
      expect(() => matcher("***")).toThrow("***");
    });

    it("rejects ** embedded in segment", () => {
      expect(() => matcher("src/**.ts")).toThrow("** must be an entire segment");
    });

    it("rejects character classes", () => {
      expect(() => matcher("[abc]")).toThrow("character class");
    });

    it("rejects brace expansion", () => {
      expect(() => matcher("*.{ts,js}")).toThrow("brace");
    });

    it("rejects extglob", () => {
      expect(() => matcher("@(foo|bar)")).toThrow();
    });

    it("rejects leading slash in pattern", () => {
      expect(() => matcher("/src/**")).toThrow("leading or trailing slash");
    });

    it("rejects trailing slash in pattern", () => {
      expect(() => matcher("src/")).toThrow("leading or trailing slash");
    });
  });

  describe("duplicate patterns", () => {
    it("rejects duplicates within the same source", () => {
      expect(() =>
        CanonicalPathMatcher.compile([
          { pattern: "src/**", source: "org" },
          { pattern: "src/**", source: "org" },
        ]),
      ).toThrow("Duplicate");
    });

    it("deduplicates across different sources", () => {
      const m = CanonicalPathMatcher.compile([
        { pattern: "**/.env", source: "app-defaults" },
        { pattern: "**/.env", source: "org-security" },
      ]);
      expect(m.patterns).toEqual(["**/.env"]);
      expect(m.getSource("**/.env")).toBe("app-defaults");
    });
  });

  describe("content hash", () => {
    it("same patterns produce same hash", () => {
      const m1 = matcher("src/**", "**/.env");
      const m2 = matcher("src/**", "**/.env");
      expect(m1.contentHash).toBe(m2.contentHash);
    });

    it("different patterns produce different hash", () => {
      const m1 = matcher("src/**");
      const m2 = matcher("lib/**");
      expect(m1.contentHash).not.toBe(m2.contentHash);
    });

    it("different order produces different hash", () => {
      const m1 = matcher("src/**", "lib/**");
      const m2 = matcher("lib/**", "src/**");
      expect(m1.contentHash).not.toBe(m2.contentHash);
    });
  });
});
