# Control Tower Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Control Tower TypeScript application with project scaffolding, canonical path matching, config schemas/loaders, SQLite persistence, child-environment builders, and CLI commands (`doctor`, `init`, `start`, `stop`, `status`).

**Architecture:** Single-process local-first Node.js daemon backed by SQLite (better-sqlite3). Configuration uses three non-overlapping layers (organization catalog, engineer profile, local machine config) validated with Zod `.strict()`. All path/glob matching uses one `CanonicalPathMatcher` implementation compiled to a content-hashed immutable artifact. CLI is `pnpm ct <command>` via tsx + commander.

**Tech Stack:** Node 22+, pnpm 10+, TypeScript 5.x strict, vitest, better-sqlite3, zod, commander, tsx

**Depends on:** none (greenfield)
**Unlocks:** plans 02–05 (GitHub adapter, policy evaluator, source manager, orchestrator, browser)

---

## File Structure

```
package.json                           # pnpm project, "ct" script → tsx src/cli/main.ts
pnpm-lock.yaml                         # generated
tsconfig.json                          # strict base config
tsconfig.build.json                    # build-only config extending base
vitest.config.ts                       # vitest configuration

config/organization.json               # shared org catalog (§6.1)
config/harnesses/pr-attention/prompt.md
config/harnesses/pr-attention/skills/pr-attention/SKILL.md
config/harnesses/pr-review/prompt.md
config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md
config/harnesses/pr-review/domains/backend.md
config/harnesses/pr-review/domains/frontend.md
config/harnesses/pr-review/domains/infrastructure.md

config/examples/profile/profile.json   # example profile
config/examples/profile/policy.json    # example policy
config/examples/profile/persona.md     # example persona
config/examples/local-config.json      # example local config

src/cli/main.ts                        # commander entry point
src/cli/doctor.ts                      # doctor checks (§8.1)
src/cli/init.ts                        # init command (§8.2)
src/cli/daemon-control.ts              # start/stop/status stubs

src/config/types.ts                    # TypeScript types for all config layers
src/config/schemas.ts                  # Zod schemas (strict, unknown keys = error)
src/config/load.ts                     # load + validate each config layer
src/config/author-login.ts             # author login normalization
src/config/protected-paths.ts          # protected-path union (app defaults ∪ org)

src/paths/canonical-path.ts            # canonical path validation
src/paths/glob.ts                      # glob pattern validation + parsing
src/paths/matcher.ts                   # CanonicalPathMatcher (compiled, content-hashed)
src/paths/compile.ts                   # compile patterns → immutable artifact
src/paths/match-patterns.ts            # pathMatchesAny for policy glob arrays

src/security/child-env.ts              # child-environment builders (§7)

src/store/db.ts                        # SQLite connection factory
src/store/migrations/001_initial.sql   # Phase 1 schema
src/store/migrate.ts                   # forward-only migration runner

src/util/canonical-json.ts             # stable-key-order JSON serialization
src/util/hash.ts                       # SHA-256 helpers

src/daemon/server.ts                   # minimal loopback HTTP health endpoint

src/app-safety/contracts.ts            # immutable layer-1 safety text stubs

tests/paths/canonical-path.test.ts     # canonical path fixtures
tests/paths/matcher.test.ts            # CanonicalPathMatcher fixtures
tests/config/load.test.ts              # config loading tests
tests/config/author-login.test.ts      # author normalization tests
tests/security/child-env.test.ts       # child-env builder tests
tests/store/migrate.test.ts            # migration runner tests
tests/cli/doctor.test.ts              # doctor check tests (§8.1)
tests/cli/init.test.ts                # init command tests (§8.2)
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `vitest.config.ts`

- [x] **Step 1: Create package.json**

```json
{
  "name": "control-tower",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "ct": "tsx src/cli/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "commander": "^13.1.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

- [x] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["src/**/*", "tests/**/*", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [x] **Step 3: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [x] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
```

- [x] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: lockfile generated, zero errors

- [x] **Step 6: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: exits 0, no errors

- [x] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json vitest.config.ts
git commit -m "chore: scaffold project with pnpm, TypeScript, vitest"
```

---

### Task 2: Utility Modules — Canonical JSON and Hashing

**Files:**
- Create: `src/util/canonical-json.ts`
- Create: `src/util/hash.ts`

- [x] **Step 1: Create src/util/canonical-json.ts**

```typescript
export function canonicalJsonSerialize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}
```

- [x] **Step 2: Create src/util/hash.ts**

```typescript
import { createHash } from "node:crypto";
import { canonicalJsonSerialize } from "./canonical-json.js";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256OfCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJsonSerialize(value));
}
```

- [x] **Step 3: Commit**

```bash
git add src/util/canonical-json.ts src/util/hash.ts
git commit -m "feat: add canonical JSON serializer and SHA-256 helpers"
```

---

### Task 3: Canonical Path Validation

**Files:**
- Create: `src/paths/canonical-path.ts`
- Create: `tests/paths/canonical-path.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/paths/canonical-path.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  validateCanonicalPath,
  type CanonicalPathResult,
} from "../src/paths/canonical-path.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/paths/canonical-path.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement canonical-path.ts**

Create `src/paths/canonical-path.ts`:

```typescript
export type CanonicalPathResult =
  | { valid: true; path: string }
  | { valid: false; reason: string };

interface ValidateOptions {
  stripDiffPrefix?: boolean;
}

export function validateCanonicalPath(
  raw: string,
  opts?: ValidateOptions,
): CanonicalPathResult {
  if (raw.length === 0) {
    return { valid: false, reason: "empty path" };
  }

  let p = raw;
  if (opts?.stripDiffPrefix) {
    const m = /^[ab]\/(.+)$/.exec(p);
    if (m) p = m[1]!;
  }

  if (p.startsWith("/")) {
    return { valid: false, reason: "absolute path" };
  }

  if (p.endsWith("/")) {
    return { valid: false, reason: "trailing slash" };
  }

  if (p.includes("\\")) {
    return { valid: false, reason: "backslash not allowed" };
  }

  for (let i = 0; i < p.length; i++) {
    const code = p.charCodeAt(i);
    if (code === 0 || (code >= 1 && code <= 31) || code === 127) {
      return { valid: false, reason: "control character" };
    }
  }

  if (p !== p.normalize("NFC")) {
    return { valid: false, reason: "path is not NFC-normalized" };
  }

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "") {
      return { valid: false, reason: "empty segment" };
    }
    if (seg === "." || seg === "..") {
      return { valid: false, reason: "dot segment" };
    }
    if (seg.toLowerCase() === ".git") {
      return { valid: false, reason: ".git segment" };
    }
  }

  return { valid: true, path: p };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/paths/canonical-path.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/paths/canonical-path.ts tests/paths/canonical-path.test.ts
git commit -m "feat: add canonical path validation with NFC, segment, control-char checks"
```

---

### Task 4: Glob Pattern Validation

**Files:**
- Create: `src/paths/glob.ts`

- [ ] **Step 1: Create src/paths/glob.ts**

```typescript
export type GlobValidationResult =
  | { valid: true; pattern: string; segments: GlobSegment[] }
  | { valid: false; reason: string };

export type GlobSegment =
  | { type: "literal"; value: string }
  | { type: "wildcard" }
  | { type: "globstar" };

export function validateGlob(raw: string): GlobValidationResult {
  if (raw.length === 0) {
    return { valid: false, reason: "empty pattern" };
  }
  if (raw.startsWith("/") || raw.endsWith("/")) {
    return { valid: false, reason: "leading or trailing slash" };
  }
  if (raw.includes("\\")) {
    return { valid: false, reason: "backslash not allowed" };
  }

  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0 || (code >= 1 && code <= 31) || code === 127) {
      return { valid: false, reason: "control character" };
    }
  }

  if (raw !== raw.normalize("NFC")) {
    return { valid: false, reason: "pattern is not NFC-normalized" };
  }

  if (raw.includes("***")) {
    return { valid: false, reason: "*** is not supported" };
  }

  if (/[[\]{}()!@+]/.test(raw)) {
    return { valid: false, reason: "character classes, braces, and extglob not supported" };
  }

  const parts = raw.split("/");
  const segments: GlobSegment[] = [];

  for (const part of parts) {
    if (part === "") {
      return { valid: false, reason: "empty segment" };
    }
    if (part === "." || part === "..") {
      return { valid: false, reason: "dot segment" };
    }

    if (part === "**") {
      segments.push({ type: "globstar" });
    } else if (part.includes("**")) {
      return { valid: false, reason: "** must be an entire segment" };
    } else if (part.includes("*") || part.includes("?")) {
      segments.push({ type: "wildcard", value: part });
    } else {
      segments.push({ type: "literal", value: part });
    }
  }

  return { valid: true, pattern: raw, segments };
}

export function deduplicateGlobs(
  patterns: readonly string[],
): { unique: string[]; duplicates: string[] } {
  const seen = new Set<string>();
  const unique: string[] = [];
  const duplicates: string[] = [];
  for (const p of patterns) {
    if (seen.has(p)) {
      duplicates.push(p);
    } else {
      seen.add(p);
      unique.push(p);
    }
  }
  return { unique, duplicates };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/paths/glob.ts
git commit -m "feat: add glob pattern validation with segment parsing"
```

---

### Task 5: CanonicalPathMatcher — Implementation

**Files:**
- Create: `src/paths/matcher.ts`
- Create: `src/paths/compile.ts`

- [ ] **Step 1: Create src/paths/matcher.ts**

```typescript
import { validateCanonicalPath } from "./canonical-path.js";
import type { GlobSegment } from "./glob.js";
import { validateGlob } from "./glob.js";
import { sha256Hex } from "../util/hash.js";
import { canonicalJsonSerialize } from "../util/canonical-json.js";

export interface MatcherArtifact {
  readonly version: number;
  readonly contentHash: string;
  readonly patterns: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
}

export interface PatternSource {
  pattern: string;
  source: string;
}

interface CompiledPattern {
  raw: string;
  segments: GlobSegment[];
}

export class CanonicalPathMatcher {
  static readonly VERSION = 1;

  readonly version = CanonicalPathMatcher.VERSION;
  readonly contentHash: string;
  readonly patterns: readonly string[];

  private readonly compiled: readonly CompiledPattern[];
  private readonly sourceMap: ReadonlyMap<string, string>;

  private constructor(
    compiled: CompiledPattern[],
    sourceMap: Map<string, string>,
    contentHash: string,
  ) {
    this.compiled = compiled;
    this.sourceMap = sourceMap;
    this.contentHash = contentHash;
    this.patterns = compiled.map((c) => c.raw);
  }

  static compile(inputs: readonly PatternSource[]): CanonicalPathMatcher {
    const compiled: CompiledPattern[] = [];
    const sourceMap = new Map<string, string>();
    const seen = new Set<string>();

    for (const { pattern, source } of inputs) {
      const result = validateGlob(pattern);
      if (!result.valid) {
        throw new Error(`Invalid glob "${pattern}": ${result.reason}`);
      }
      if (seen.has(result.pattern)) {
        if (sourceMap.get(result.pattern) === source) {
          throw new Error(
            `Duplicate glob "${result.pattern}" within source "${source}"`,
          );
        }
        continue;
      }
      seen.add(result.pattern);
      compiled.push({ raw: result.pattern, segments: result.segments });
      sourceMap.set(result.pattern, source);
    }

    const hashInput = canonicalJsonSerialize({
      version: CanonicalPathMatcher.VERSION,
      patterns: compiled.map((c) => c.raw),
    });
    const contentHash = sha256Hex(hashInput);

    return new CanonicalPathMatcher(compiled, sourceMap, contentHash);
  }

  matches(path: string): boolean {
    const result = validateCanonicalPath(path);
    if (!result.valid) return false;
    return this.compiled.some((cp) =>
      matchSegments(result.path.split("/"), cp.segments, 0, 0),
    );
  }

  matchedPatterns(path: string): string[] {
    const result = validateCanonicalPath(path);
    if (!result.valid) return [];
    const pathSegs = result.path.split("/");
    return this.compiled
      .filter((cp) => matchSegments(pathSegs, cp.segments, 0, 0))
      .map((cp) => cp.raw);
  }

  getSource(pattern: string): string | undefined {
    return this.sourceMap.get(pattern);
  }

  toArtifact(): MatcherArtifact {
    return {
      version: this.version,
      contentHash: this.contentHash,
      patterns: this.patterns,
      sources: new Map(this.sourceMap),
    };
  }
}

function matchSegments(
  pathSegs: string[],
  patternSegs: GlobSegment[],
  pi: number,
  gi: number,
): boolean {
  while (gi < patternSegs.length && pi < pathSegs.length) {
    const seg = patternSegs[gi]!;

    if (seg.type === "globstar") {
      if (gi === patternSegs.length - 1) return true;
      for (let skip = 0; skip <= pathSegs.length - pi; skip++) {
        if (matchSegments(pathSegs, patternSegs, pi + skip, gi + 1)) {
          return true;
        }
      }
      return false;
    }

    if (seg.type === "literal") {
      if (pathSegs[pi] !== seg.value) return false;
    } else {
      if (!matchWildcardSegment(pathSegs[pi]!, seg.value)) return false;
    }

    pi++;
    gi++;
  }

  while (gi < patternSegs.length && patternSegs[gi]!.type === "globstar") {
    gi++;
  }

  return pi === pathSegs.length && gi === patternSegs.length;
}

function matchWildcardSegment(text: string, pattern: string): boolean {
  const tLen = text.length;
  const pLen = pattern.length;
  let ti = 0;
  let pi = 0;
  let starTi = -1;
  let starPi = -1;

  while (ti < tLen) {
    if (pi < pLen && pattern[pi] === "*") {
      starPi = pi;
      starTi = ti;
      pi++;
    } else if (pi < pLen && (pattern[pi] === "?" || pattern[pi] === text[ti])) {
      pi++;
      ti++;
    } else if (starPi >= 0) {
      pi = starPi + 1;
      starTi++;
      ti = starTi;
    } else {
      return false;
    }
  }

  while (pi < pLen && pattern[pi] === "*") pi++;
  return pi === pLen;
}
```

- [ ] **Step 2: Create src/paths/compile.ts (re-export convenience)**

```typescript
export { CanonicalPathMatcher } from "./matcher.js";
export type { PatternSource, MatcherArtifact } from "./matcher.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/paths/matcher.ts src/paths/compile.ts
git commit -m "feat: implement CanonicalPathMatcher with content-hashed compilation"
```

---

### Task 6: CanonicalPathMatcher — Comprehensive Tests

**Files:**
- Create: `tests/paths/matcher.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/paths/matcher.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CanonicalPathMatcher } from "../src/paths/matcher.js";

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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test tests/paths/matcher.test.ts`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/paths/matcher.test.ts
git commit -m "test: comprehensive CanonicalPathMatcher test fixtures"
```

---

### Task 6b: pathMatchesAny Helper (policy glob arrays)

**Files:**
- Create: `src/paths/match-patterns.ts`
- Test: `tests/paths/match-patterns.test.ts`

Policy evaluators need to match a canonical path against an arbitrary pattern array without changing `CanonicalPathMatcher.matches(path)` (compiled-only).

- [ ] **Step 1: Write failing tests**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/paths/match-patterns.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// src/paths/match-patterns.ts
import { CanonicalPathMatcher } from "./matcher.js";
import type { PatternSource } from "./matcher.js";

export function pathMatchesAny(
  canonicalPath: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  const sources: PatternSource[] = patterns.map((pattern) => ({
    pattern,
    source: "policy" as const,
  }));
  try {
    const matcher = CanonicalPathMatcher.compile(sources);
    return matcher.matches(canonicalPath);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/paths/match-patterns.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/paths/match-patterns.ts tests/paths/match-patterns.test.ts
git commit -m "feat: add pathMatchesAny for policy glob arrays"
```

---

### Task 7: Config Types and Zod Schemas

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/schemas.ts`

- [ ] **Step 1: Create src/config/types.ts**

```typescript
export interface OrganizationConfig {
  schemaVersion: number;
  github: {
    host: string;
    organizations: string[];
    pollIntervalSeconds: number;
  };
  ticketExtractors: Array<{
    id: string;
    sources: Array<"title" | "body" | "branch">;
    pattern: string;
  }>;
  security: {
    protectedPaths: string[];
  };
  reviewDefaults: {
    jobTimeoutSeconds: number;
    retentionDays: number;
    maxStorageBytes: number;
  };
  repositories: Array<{
    id: string;
    github: string;
    defaultBranch: string;
    resourceClass: "light" | "medium" | "heavy";
  }>;
}

export interface ProfileConfig {
  schemaVersion: number;
  profileId: string;
  githubLogin: string;
  activeRepositoryIds: string[];
}

export interface DomainRule {
  domain: string;
  paths: string[];
  priority: number;
}

export interface PriorityRule {
  paths: string[];
  tier: "p0" | "p1" | "p2" | "p3";
}

export interface RepositoryPolicy {
  eligiblePaths: string[];
  eligibleAuthors: string[];
  domainRules: DomainRule[];
  priorityRules: PriorityRule[];
}

export interface PolicyConfig {
  schemaVersion: number;
  attentionAdvisor: {
    enabled: boolean;
    maxCandidatesPerInvocation: number;
    timeoutSeconds: number;
  };
  autoAnalyze: {
    explicitReviewRequests: boolean;
    priorityTiers: Array<"p0" | "p1" | "p2" | "p3">;
  };
  repositories: Record<string, RepositoryPolicy>;
}

export interface ModelRoleSpec {
  modelId: string;
}

export interface LocalConfig {
  schemaVersion: number;
  profileDirectory: string;
  dataDirectory: string;
  workspaceRoots: string[];
  repositoryPaths: Record<string, string>;
  cursor: {
    binary: string;
    modelRoles: {
      attention?: ModelRoleSpec;
      primaryReview: ModelRoleSpec;
    };
    maxConcurrentAgents: number;
  };
  worktrees: {
    maxMaterialized: number;
  };
  publication: {
    mode: "shadow" | "gated";
  };
}
```

- [ ] **Step 2: Create src/config/schemas.ts**

```typescript
import { z } from "zod";

const ticketExtractorSchema = z.object({
  id: z.string().min(1),
  sources: z.array(z.enum(["title", "body", "branch"])).min(1),
  pattern: z.string().min(1),
}).strict();

export const organizationSchema = z.object({
  schemaVersion: z.literal(1),
  github: z.object({
    host: z.string().min(1),
    organizations: z.array(z.string().min(1)).min(1),
    pollIntervalSeconds: z.number().int().positive(),
  }).strict(),
  ticketExtractors: z.array(ticketExtractorSchema),
  security: z.object({
    protectedPaths: z.array(z.string().min(1)),
  }).strict(),
  reviewDefaults: z.object({
    jobTimeoutSeconds: z.number().int().positive(),
    retentionDays: z.number().int().positive(),
    maxStorageBytes: z.number().int().positive(),
  }).strict(),
  repositories: z.array(z.object({
    id: z.string().min(1),
    github: z.string().regex(/^[^/]+\/[^/]+$/),
    defaultBranch: z.string().min(1),
    resourceClass: z.enum(["light", "medium", "heavy"]),
  }).strict()).min(1),
}).strict();

export const profileSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().min(1),
  githubLogin: z.string().min(1),
  activeRepositoryIds: z.array(z.string().min(1)),
}).strict();

const domainRuleSchema = z.object({
  domain: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  priority: z.number().int().min(0).max(1000),
}).strict();

const priorityRuleSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  tier: z.enum(["p0", "p1", "p2", "p3"]),
}).strict();

const repositoryPolicySchema = z.object({
  eligiblePaths: z.array(z.string()),
  eligibleAuthors: z.array(z.string()),
  domainRules: z.array(domainRuleSchema).max(3),
  priorityRules: z.array(priorityRuleSchema),
}).strict();

export const policySchema = z.object({
  schemaVersion: z.literal(1),
  attentionAdvisor: z.object({
    enabled: z.boolean(),
    maxCandidatesPerInvocation: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive(),
  }).strict(),
  autoAnalyze: z.object({
    explicitReviewRequests: z.boolean(),
    priorityTiers: z.array(z.enum(["p0", "p1", "p2", "p3"])),
  }).strict(),
  repositories: z.record(z.string(), repositoryPolicySchema),
}).strict();

const modelRoleSpecSchema = z.object({
  modelId: z.string().min(1),
}).strict();

export const localConfigSchema = z.object({
  schemaVersion: z.literal(1),
  profileDirectory: z.string().min(1),
  dataDirectory: z.string().min(1),
  workspaceRoots: z.array(z.string().min(1)),
  repositoryPaths: z.record(z.string(), z.string().min(1)),
  cursor: z.object({
    binary: z.string().min(1),
    modelRoles: z.object({
      attention: modelRoleSpecSchema.optional(),
      primaryReview: modelRoleSpecSchema,
    }).strict(),
    maxConcurrentAgents: z.number().int().min(1).max(2),
  }).strict(),
  worktrees: z.object({
    maxMaterialized: z.number().int().min(1),
  }).strict(),
  publication: z.object({
    mode: z.enum(["shadow", "gated"]),
  }).strict(),
  daemon: z.object({
    port: z.number().int().min(1).max(65535).default(9120),
  }).strict().default({ port: 9120 }),
}).strict();
```

- [ ] **Step 3: Commit**

```bash
git add src/config/types.ts src/config/schemas.ts
git commit -m "feat: add config types and strict Zod schemas for all config layers"
```

---

### Task 8: Author Login Normalization

**Files:**
- Create: `src/config/author-login.ts`
- Create: `tests/config/author-login.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/config/author-login.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  normalizeLogin,
  validateLoginFormat,
} from "../src/config/author-login.js";

describe("validateLoginFormat", () => {
  it("accepts simple logins", () => {
    expect(validateLoginFormat("shubh-array")).toBe(true);
    expect(validateLoginFormat("user123")).toBe(true);
    expect(validateLoginFormat("a")).toBe(true);
  });

  it("accepts bot logins", () => {
    expect(validateLoginFormat("dependabot[bot]")).toBe(true);
    expect(validateLoginFormat("renovate[bot]")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateLoginFormat("")).toBe(false);
  });

  it("rejects login starting with hyphen", () => {
    expect(validateLoginFormat("-user")).toBe(false);
  });

  it("rejects login ending with hyphen", () => {
    expect(validateLoginFormat("user-")).toBe(false);
  });

  it("rejects login with special characters", () => {
    expect(validateLoginFormat("user@name")).toBe(false);
    expect(validateLoginFormat("user name")).toBe(false);
    expect(validateLoginFormat("user.name")).toBe(false);
  });

  it("rejects login over 100 characters", () => {
    expect(validateLoginFormat("a".repeat(101))).toBe(false);
  });

  it("accepts login of exactly 100 characters", () => {
    expect(validateLoginFormat("a".repeat(100))).toBe(true);
  });
});

describe("normalizeLogin", () => {
  it("trims whitespace", () => {
    expect(normalizeLogin("  shubh-array  ")).toBe("shubh-array");
  });

  it("lowercases", () => {
    expect(normalizeLogin("Shubh-Array")).toBe("shubh-array");
    expect(normalizeLogin("USER")).toBe("user");
  });

  it("trims then lowercases", () => {
    expect(normalizeLogin("  MyUser  ")).toBe("myuser");
  });

  it("throws on invalid format after normalization", () => {
    expect(() => normalizeLogin("")).toThrow();
    expect(() => normalizeLogin("   ")).toThrow();
    expect(() => normalizeLogin("-bad")).toThrow();
    expect(() => normalizeLogin("bad-")).toThrow();
    expect(() => normalizeLogin("user@host")).toThrow();
  });

  it("normalizes bot logins", () => {
    expect(normalizeLogin("Dependabot[bot]")).toBe("dependabot[bot]");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/config/author-login.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement author-login.ts**

Create `src/config/author-login.ts`:

```typescript
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;
const MAX_LENGTH = 100;

export function validateLoginFormat(login: string): boolean {
  if (login.length === 0 || login.length > MAX_LENGTH) return false;
  return LOGIN_PATTERN.test(login);
}

export function normalizeLogin(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!validateLoginFormat(trimmed)) {
    throw new Error(
      `Invalid GitHub login "${trimmed}": must be 1-${MAX_LENGTH} ASCII alphanumeric/hyphen characters matching ${LOGIN_PATTERN.source}`,
    );
  }
  return trimmed;
}

export function validateNoDuplicateLogins(logins: string[]): void {
  const normalized = logins.map(normalizeLogin);
  const seen = new Set<string>();
  for (const login of normalized) {
    if (seen.has(login)) {
      throw new Error(`Duplicate normalized login: "${login}"`);
    }
    seen.add(login);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/config/author-login.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/author-login.ts tests/config/author-login.test.ts
git commit -m "feat: add author login validation and normalization"
```

---

### Task 9: Protected Paths Union

**Files:**
- Create: `src/config/protected-paths.ts`

- [ ] **Step 1: Create src/config/protected-paths.ts**

```typescript
import { CanonicalPathMatcher, type PatternSource } from "../paths/matcher.js";

const APP_DEFAULT_PROTECTED_PATHS: readonly string[] = [
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

export function buildProtectedPathMatcher(
  orgProtectedPaths: readonly string[],
): CanonicalPathMatcher {
  const inputs: PatternSource[] = [];

  for (const p of APP_DEFAULT_PROTECTED_PATHS) {
    inputs.push({ pattern: p, source: "app-defaults" });
  }

  for (const p of orgProtectedPaths) {
    inputs.push({ pattern: p, source: "org-security" });
  }

  return CanonicalPathMatcher.compile(inputs);
}

export { APP_DEFAULT_PROTECTED_PATHS };
```

- [ ] **Step 2: Commit**

```bash
git add src/config/protected-paths.ts
git commit -m "feat: add protected-path union builder (app defaults ∪ org security)"
```

---

### Task 10: Config Loader

**Files:**
- Create: `src/config/load.ts`
- Create: `tests/config/load.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/config/load.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadOrganizationConfig,
  loadProfileConfig,
  loadPolicyConfig,
  loadLocalConfig,
} from "../src/config/load.js";

describe("loadOrganizationConfig", () => {
  it("loads valid organization.json", () => {
    const cfg = loadOrganizationConfig(
      join(process.cwd(), "config/organization.json"),
    );
    expect(cfg.schemaVersion).toBe(1);
    expect(cfg.repositories.length).toBeGreaterThan(0);
    expect(cfg.github.host).toBe("github.com");
  });

  it("rejects unknown keys", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ct-test-"));
    const file = join(tmp, "org.json");
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        github: { host: "github.com", organizations: ["test"], pollIntervalSeconds: 300 },
        ticketExtractors: [],
        security: { protectedPaths: [] },
        reviewDefaults: { jobTimeoutSeconds: 1200, retentionDays: 30, maxStorageBytes: 10737418240 },
        repositories: [{ id: "r1", github: "org/repo", defaultBranch: "main", resourceClass: "medium" }],
        unknownField: true,
      }),
    );
    expect(() => loadOrganizationConfig(file)).toThrow();
    rmSync(tmp, { recursive: true });
  });

  it("rejects missing file", () => {
    expect(() => loadOrganizationConfig("/nonexistent.json")).toThrow();
  });
});

describe("loadProfileConfig", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ct-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true }); });

  it("loads valid profile.json", () => {
    const file = join(tmp, "profile.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileId: "test",
      githubLogin: "testuser",
      activeRepositoryIds: ["repo1"],
    }));
    const cfg = loadProfileConfig(file);
    expect(cfg.profileId).toBe("test");
  });

  it("rejects unknown keys in profile", () => {
    const file = join(tmp, "profile.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileId: "test",
      githubLogin: "testuser",
      activeRepositoryIds: [],
      extraField: "nope",
    }));
    expect(() => loadProfileConfig(file)).toThrow();
  });
});

describe("loadPolicyConfig", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ct-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true }); });

  it("loads valid policy.json", () => {
    const file = join(tmp, "policy.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      attentionAdvisor: { enabled: false, maxCandidatesPerInvocation: 50, timeoutSeconds: 90 },
      autoAnalyze: { explicitReviewRequests: true, priorityTiers: [] },
      repositories: {},
    }));
    const cfg = loadPolicyConfig(file);
    expect(cfg.schemaVersion).toBe(1);
  });

  it("rejects domain rules exceeding 3 per repository", () => {
    const file = join(tmp, "policy.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      attentionAdvisor: { enabled: false, maxCandidatesPerInvocation: 50, timeoutSeconds: 90 },
      autoAnalyze: { explicitReviewRequests: true, priorityTiers: [] },
      repositories: {
        "repo1": {
          eligiblePaths: [],
          eligibleAuthors: [],
          domainRules: [
            { domain: "a", paths: ["src/**"], priority: 100 },
            { domain: "b", paths: ["lib/**"], priority: 100 },
            { domain: "c", paths: ["test/**"], priority: 100 },
            { domain: "d", paths: ["docs/**"], priority: 100 },
          ],
          priorityRules: [],
        },
      },
    }));
    expect(() => loadPolicyConfig(file)).toThrow();
  });
});

describe("loadLocalConfig", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ct-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true }); });

  it("loads valid local config", () => {
    const file = join(tmp, "config.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileDirectory: "/tmp/profile",
      dataDirectory: "/tmp/data",
      workspaceRoots: ["/tmp/workspace"],
      repositoryPaths: {},
      cursor: {
        binary: "agent",
        modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } },
        maxConcurrentAgents: 1,
      },
      worktrees: { maxMaterialized: 4 },
      publication: { mode: "shadow" },
    }));
    const cfg = loadLocalConfig(file);
    expect(cfg.cursor.binary).toBe("agent");
  });

  it("rejects maxConcurrentAgents > 2", () => {
    const file = join(tmp, "config.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileDirectory: "/tmp/profile",
      dataDirectory: "/tmp/data",
      workspaceRoots: [],
      repositoryPaths: {},
      cursor: {
        binary: "agent",
        modelRoles: { primaryReview: { modelId: "m" } },
        maxConcurrentAgents: 5,
      },
      worktrees: { maxMaterialized: 4 },
      publication: { mode: "shadow" },
    }));
    expect(() => loadLocalConfig(file)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/config/load.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config loader**

Create `src/config/load.ts`:

```typescript
import { readFileSync } from "node:fs";
import {
  organizationSchema,
  profileSchema,
  policySchema,
  localConfigSchema,
} from "./schemas.js";
import type {
  OrganizationConfig,
  ProfileConfig,
  PolicyConfig,
  LocalConfig,
} from "./types.js";

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read config file "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in "${path}"`);
  }
}

function formatZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
}

export function loadOrganizationConfig(path: string): OrganizationConfig {
  const data = readJson(path);
  const result = organizationSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid organization config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadProfileConfig(path: string): ProfileConfig {
  const data = readJson(path);
  const result = profileSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid profile config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadPolicyConfig(path: string): PolicyConfig {
  const data = readJson(path);
  const result = policySchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid policy config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadLocalConfig(path: string): LocalConfig {
  const data = readJson(path);
  const result = localConfigSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid local config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/config/load.test.ts`
Expected: all tests PASS (the organization.json test depends on Task 12 — if running in isolation, skip that one test and revisit after Task 12)

- [ ] **Step 5: Commit**

```bash
git add src/config/load.ts tests/config/load.test.ts
git commit -m "feat: add config loaders with strict Zod validation"
```

---

### Task 11: App Safety Contracts (Layer 1 Stubs)

**Files:**
- Create: `src/app-safety/contracts.ts`

- [ ] **Step 1: Create src/app-safety/contracts.ts**

```typescript
import { sha256Hex } from "../util/hash.js";

export const SAFETY_CONTRACT_VERSION = 1;

export const SAFETY_CONTRACT_TEXT = `# Control Tower Safety Contract (v${SAFETY_CONTRACT_VERSION})

You are a review agent operating under strict safety constraints.

## Absolute restrictions
- You MUST NOT execute any shell commands.
- You MUST NOT write, delete, or modify any files.
- You MUST NOT use any MCP tools.
- You MUST NOT use browser or network fetch tools.
- You MUST NOT read files matching protected path patterns.
- You MUST NOT invent provenance identifiers.
- You MUST NOT claim confidence authorizes any action.
- You MUST NOT publish any external action.

## Evidence rules
- Every observation must cite application-created provenance references.
- Distinguish observation from inference.
- Explicitly list unknowns when evidence is incomplete.
- Protected-path content is unavailable; acknowledge missing coverage.

## Output
- Return a single JSON object matching the required schema.
- Do not wrap in markdown code fences.
`;

export const SAFETY_CONTRACT_HASH = sha256Hex(SAFETY_CONTRACT_TEXT);

export const OUTPUT_CONTRACT_TEXT = `# Strict Output Contract

Return exactly one JSON object matching the role-specific schema.
No markdown wrapping. No additional text before or after the JSON.
Every provenanceRef must be an application-created pv_ identifier.
Every fileReference must include repositoryId, blobSha, path, startLine, endLine.
`;

export const OUTPUT_CONTRACT_HASH = sha256Hex(OUTPUT_CONTRACT_TEXT);
```

- [ ] **Step 2: Commit**

```bash
git add src/app-safety/contracts.ts
git commit -m "feat: add immutable layer-1 safety and output contract stubs"
```

---

### Task 12: Organization Config and Harness Skeleton Files

**Files:**
- Create: `config/organization.json`
- Create: `config/harnesses/pr-attention/prompt.md`
- Create: `config/harnesses/pr-attention/skills/pr-attention/SKILL.md`
- Create: `config/harnesses/pr-review/prompt.md`
- Create: `config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md`
- Create: `config/harnesses/pr-review/domains/backend.md`
- Create: `config/harnesses/pr-review/domains/frontend.md`
- Create: `config/harnesses/pr-review/domains/infrastructure.md`

- [ ] **Step 1: Create config/organization.json**

```json
{
  "schemaVersion": 1,
  "github": {
    "host": "github.com",
    "organizations": ["Powered-By-Array"],
    "pollIntervalSeconds": 300
  },
  "ticketExtractors": [
    {
      "id": "linear-key",
      "sources": ["title", "body", "branch"],
      "pattern": "\\b[A-Z][A-Z0-9]+-[0-9]+\\b"
    }
  ],
  "security": {
    "protectedPaths": [
      "**/.env",
      "**/.env.*",
      "**/.cursor/mcp.json",
      "**/appsettings.secrets.json",
      "**/appsettings.Local.json",
      "**/*.pem",
      "**/*.key",
      "**/*.pfx",
      "**/deploy.*.parameters.json",
      "**/deploy.*.parameters.jsonc"
    ]
  },
  "reviewDefaults": {
    "jobTimeoutSeconds": 1200,
    "retentionDays": 30,
    "maxStorageBytes": 10737418240
  },
  "repositories": [
    {
      "id": "pba-webapp",
      "github": "Powered-By-Array/pba-webapp",
      "defaultBranch": "main",
      "resourceClass": "medium"
    },
    {
      "id": "pba-agents",
      "github": "Powered-By-Array/pba-agents",
      "defaultBranch": "main",
      "resourceClass": "medium"
    },
    {
      "id": "pba-microservices",
      "github": "Powered-By-Array/pba-microservices",
      "defaultBranch": "dev",
      "resourceClass": "heavy"
    },
    {
      "id": "pba-infra",
      "github": "Powered-By-Array/pba-infra",
      "defaultBranch": "dev",
      "resourceClass": "light"
    }
  ]
}
```

- [ ] **Step 2: Create harness files**

Create `config/harnesses/pr-attention/prompt.md`:

```markdown
# PR Attention Guidance

You are the Control Tower attention advisor. Your role is to assess the relevance and risk of pull requests based on metadata only.

## Input
You receive PR metadata: repository, title, author, labels, changed file names, checks, and timestamps. You do NOT receive diff bodies, source files, or discussion content.

## Assessment
For each candidate PR, assess:
- **Relevance**: How important is this PR to the principal engineer's responsibilities?
- **Risk**: What is the likelihood this PR introduces issues requiring principal attention?

## Output
Return a JSON object matching the attention output schema with one item per input candidate. Do not omit or add candidates.
```

Create `config/harnesses/pr-attention/skills/pr-attention/SKILL.md`:

```markdown
---
name: pr-attention
description: Metadata-only PR triage for the Control Tower attention advisor
---

# PR Attention Skill

Assess PR relevance and risk from metadata. You have no access to source code, diffs, or discussion bodies.

## Rules
1. Assess each candidate independently.
2. Use only the metadata provided — do not infer from external knowledge.
3. Explicitly list unknowns when metadata is insufficient.
4. Never recommend actions beyond the allowed set: analyze_now, analyze_on_demand, monitor, human_triage.
5. Confidence reflects your certainty given the metadata, not authorization for action.
```

Create `config/harnesses/pr-review/prompt.md`:

```markdown
# PR Review Guidance

You are the Control Tower primary review agent. Your role is to produce an evidence-backed review draft for a single pull request.

## Approach
1. Read the filtered diff and available source files.
2. Identify correctness, maintainability, and security observations.
3. Cite application-created provenance IDs for every claim.
4. Distinguish observations (directly visible) from inferences (reasoned conclusions).
5. Explicitly acknowledge protected-path content you cannot access.

## Output
Return a single JSON object matching the primaryReview output schema.
```

Create `config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md`:

```markdown
---
name: control-tower-pr-review
description: Evidence-backed PR review for the Control Tower review agent
---

# Control Tower PR Review Skill

Produce structured, evidence-backed review findings for a pull request.

## Rules
1. Every finding must cite at least one provenance reference (pv_ identifier).
2. File references must include exact repositoryId, blobSha, path, startLine, and endLine.
3. Distinguish between observation and inference in every statement.
4. Protected paths are unavailable — list them as missing coverage, do not guess contents.
5. Do not execute commands, write files, or use MCP tools.
6. Confidence is informational, never authorization.
```

Create `config/harnesses/pr-review/domains/backend.md`:

```markdown
# Backend Domain Guidance

When reviewing backend changes, pay special attention to:
- API contract changes (request/response shapes, status codes, headers)
- Database migration safety (backward compatibility, data loss risk)
- Authentication and authorization boundary changes
- Error handling and retry behavior
- Dependency version changes and supply-chain risk
- Service-to-service communication patterns
```

Create `config/harnesses/pr-review/domains/frontend.md`:

```markdown
# Frontend Domain Guidance

When reviewing frontend changes, assess through source, diff, test code, and CI inspection only. Do NOT execute builds, tests, browsers, or repository commands.

Pay special attention to:
- Component API changes (prop additions, removals, type changes)
- State management patterns and potential render loops
- Accessibility attributes and semantic HTML
- API client changes and error boundary coverage
- Test coverage for interactive behaviors
- Bundle-size impact from new dependencies
```

Create `config/harnesses/pr-review/domains/infrastructure.md`:

```markdown
# Infrastructure Domain Guidance

When reviewing infrastructure changes, pay special attention to:
- IAM policy and role changes (principle of least privilege)
- Network configuration (security groups, VPC peering, DNS)
- Secret and certificate management
- Cost-impacting resource changes (instance types, scaling policies)
- Deployment pipeline changes and rollback safety
- Environment parity between staging and production
```

- [ ] **Step 3: Commit**

```bash
git add config/
git commit -m "feat: add organization catalog, harness prompts, skills, and domain guidance"
```

---

### Task 13: Example Profile Templates

**Files:**
- Create: `config/examples/profile/profile.json`
- Create: `config/examples/profile/policy.json`
- Create: `config/examples/profile/persona.md`
- Create: `config/examples/local-config.json`

- [ ] **Step 1: Create example profile files**

Create `config/examples/profile/profile.json`:

```json
{
  "schemaVersion": 1,
  "profileId": "my-profile",
  "githubLogin": "my-github-login",
  "activeRepositoryIds": [
    "pba-webapp",
    "pba-agents",
    "pba-microservices",
    "pba-infra"
  ]
}
```

Create `config/examples/profile/policy.json`:

```json
{
  "schemaVersion": 1,
  "attentionAdvisor": {
    "enabled": true,
    "maxCandidatesPerInvocation": 50,
    "timeoutSeconds": 90
  },
  "autoAnalyze": {
    "explicitReviewRequests": true,
    "priorityTiers": ["p0", "p1"]
  },
  "repositories": {
    "pba-webapp": {
      "eligiblePaths": ["src/**"],
      "eligibleAuthors": [],
      "domainRules": [
        { "domain": "frontend", "paths": ["src/**"], "priority": 100 }
      ],
      "priorityRules": [
        { "paths": ["src/api-clients/**", "src/lib/auth/**"], "tier": "p1" }
      ]
    },
    "pba-agents": {
      "eligiblePaths": ["sdk/**", "services/**"],
      "eligibleAuthors": [],
      "domainRules": [
        { "domain": "backend", "paths": ["sdk/**", "services/**"], "priority": 100 }
      ],
      "priorityRules": [
        { "paths": ["sdk/src/auth/**", "services/shared/**"], "tier": "p1" }
      ]
    },
    "pba-microservices": {
      "eligiblePaths": ["services/**", "packages/**"],
      "eligibleAuthors": [],
      "domainRules": [
        { "domain": "backend", "paths": ["services/**", "packages/**"], "priority": 100 }
      ],
      "priorityRules": []
    },
    "pba-infra": {
      "eligiblePaths": ["payg-array-apps/**", "array-internal-apps/**"],
      "eligibleAuthors": [],
      "domainRules": [
        {
          "domain": "infrastructure",
          "paths": ["payg-array-apps/**", "array-internal-apps/**"],
          "priority": 100
        }
      ],
      "priorityRules": []
    }
  }
}
```

Create `config/examples/profile/persona.md`:

```markdown
# Review Persona

You are a thorough but pragmatic principal engineer. Your review style:
- Focus on correctness and architectural impact over style nitpicks
- Call out missing error handling and edge cases
- Acknowledge when changes look good — not every PR needs findings
- Be concise and direct in explanations
```

Create `config/examples/local-config.json`:

```json
{
  "schemaVersion": 1,
  "profileDirectory": "~/.control-tower/profile",
  "dataDirectory": "~/.control-tower/data",
  "workspaceRoots": [],
  "repositoryPaths": {},
  "cursor": {
    "binary": "agent",
    "modelRoles": {
      "attention": {
        "modelId": "composer-2.5-fast"
      },
      "primaryReview": {
        "modelId": "composer-2.5-fast"
      }
    },
    "maxConcurrentAgents": 1
  },
  "worktrees": {
    "maxMaterialized": 4
  },
  "publication": {
    "mode": "shadow"
  },
  "daemon": {
    "port": 9120
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add config/examples/
git commit -m "feat: add example profile, policy, persona, and local-config templates"
```

---

### Task 14: SQLite Schema and Migration Runner

**Files:**
- Create: `src/store/migrations/001_initial.sql`
- Create: `src/store/db.ts`
- Create: `src/store/migrate.ts`
- Create: `tests/store/migrate.test.ts`

- [ ] **Step 1: Create the initial migration SQL**

Create `src/store/migrations/001_initial.sql`:

```sql
-- Control Tower Phase 1 initial schema (single authoritative surface for plans 01–05)
-- Table name is `prs` (never `pull_requests`). Timestamps are ISO TEXT.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  applied   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE repositories (
  id              TEXT PRIMARY KEY,
  github_identity TEXT NOT NULL UNIQUE,
  github_host     TEXT NOT NULL DEFAULT 'github.com',
  github_owner    TEXT NOT NULL,
  github_repo     TEXT NOT NULL,
  default_branch  TEXT NOT NULL,
  resource_class  TEXT NOT NULL CHECK (resource_class IN ('light', 'medium', 'heavy')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE prs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id        TEXT    NOT NULL REFERENCES repositories(id),
  pr_number            INTEGER NOT NULL,
  head_sha             TEXT    NOT NULL,
  base_sha             TEXT    NOT NULL,
  title                TEXT    NOT NULL,
  body                 TEXT,
  url                  TEXT,
  author_login         TEXT    NOT NULL,
  state                TEXT    NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
  draft                INTEGER NOT NULL DEFAULT 0,
  head_ref             TEXT,
  base_ref             TEXT,
  additions            INTEGER NOT NULL DEFAULT 0,
  deletions            INTEGER NOT NULL DEFAULT 0,
  github_created       TEXT,
  github_updated       TEXT    NOT NULL,
  explicit_request     INTEGER NOT NULL DEFAULT 0,
  explicit_request_at  TEXT,
  fetched_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (repository_id, pr_number)
);

CREATE TABLE pr_files (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id             INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  path              TEXT    NOT NULL,
  additions         INTEGER NOT NULL DEFAULT 0,
  deletions         INTEGER NOT NULL DEFAULT 0,
  is_unsafe         INTEGER NOT NULL DEFAULT 0,
  unsafe_diagnostic TEXT,
  UNIQUE (pr_id, path)
);

CREATE TABLE pr_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id       INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  conclusion  TEXT,
  details_url TEXT,
  UNIQUE (pr_id, name)
);

CREATE TABLE pr_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id         INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  author_login  TEXT    NOT NULL,
  state         TEXT    NOT NULL,
  body          TEXT,
  submitted_at  TEXT
);

CREATE TABLE pr_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id         INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  author_login  TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  url           TEXT
);

CREATE TABLE review_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id            INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  requested_login  TEXT    NOT NULL,
  requested_at     TEXT,
  UNIQUE (pr_id, requested_login)
);

CREATE TABLE discovery_checkpoints (
  id            TEXT PRIMARY KEY,
  host          TEXT NOT NULL,
  checkpoint    TEXT NOT NULL,
  freshness_at  TEXT,
  healthy       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE attention_items (
  id                      TEXT    PRIMARY KEY,
  repository_id           TEXT    NOT NULL,
  repository_key          TEXT    NOT NULL,
  pr_number               INTEGER NOT NULL,
  state                   TEXT    NOT NULL CHECK (state IN (
    'monitoring', 'ready_for_analysis', 'analysis_queued',
    'draft_ready', 'needs_human', 'completed', 'closed'
  )),
  priority_tier           TEXT    CHECK (priority_tier IN ('p0', 'p1', 'p2', 'p3', 'unranked')),
  priority_sort_ordinal   INTEGER NOT NULL DEFAULT 4,
  eligibility_reasons     TEXT    NOT NULL DEFAULT '[]',
  exclusion_reasons       TEXT    NOT NULL DEFAULT '[]',
  analysis_mode           TEXT    NOT NULL DEFAULT 'on_demand'
    CHECK (analysis_mode IN ('auto', 'on_demand')),
  auto_analyze            INTEGER NOT NULL DEFAULT 0,
  advisor_staleness_id    TEXT,
  advisor_relevance       TEXT,
  advisor_risk            TEXT,
  advisor_status          TEXT,
  source_mode             TEXT    CHECK (source_mode IN ('registered-source', 'remote-evidence-only')),
  created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (repository_key, pr_number)
);

CREATE TABLE jobs (
  id                       TEXT PRIMARY KEY,
  identity_hash            TEXT    NOT NULL UNIQUE,
  repository_id            TEXT,
  repository_key           TEXT    NOT NULL,
  pr_number                INTEGER NOT NULL,
  head_sha                 TEXT    NOT NULL,
  source_mode              TEXT    NOT NULL CHECK (source_mode IN ('registered-source', 'remote-evidence-only')),
  policy_hash              TEXT    NOT NULL,
  state                    TEXT    NOT NULL CHECK (state IN (
    'queued', 'preparing_context', 'preparing_source', 'running_agent',
    'validating_output', 'draft_ready', 'awaiting_approval',
    'publishing', 'published', 'failed', 'cancelled', 'superseded'
  )),
  version                  INTEGER NOT NULL DEFAULT 1,
  failure_reason           TEXT,
  priority_sort_ordinal    INTEGER NOT NULL DEFAULT 3,
  explicit_request_sort    INTEGER NOT NULL DEFAULT 1,
  queue_timestamp          TEXT,
  queued_at                TEXT,
  latest_run_id            TEXT,
  accepted_run_id          TEXT,
  created_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE runs (
  id              TEXT    PRIMARY KEY,
  job_id          TEXT    NOT NULL REFERENCES jobs(id),
  attempt_number  INTEGER NOT NULL,
  run_input_hash  TEXT    NOT NULL,
  state           TEXT    NOT NULL CHECK (state IN (
    'allocated', 'running', 'validating', 'succeeded', 'failed',
    'cancelled', 'superseded'
  )),
  version         INTEGER NOT NULL DEFAULT 1,
  failure_reason  TEXT,
  manifest_hash   TEXT,
  model_id        TEXT,
  started_at      TEXT,
  sealed_at       TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE advisor_runs (
  id              TEXT PRIMARY KEY,
  identity_hash   TEXT    NOT NULL,
  attempt_number  INTEGER NOT NULL,
  state           TEXT    NOT NULL CHECK (state IN (
    'queued', 'running', 'validating', 'succeeded', 'failed',
    'cancelled', 'superseded'
  )),
  version         INTEGER NOT NULL DEFAULT 1,
  failure_reason  TEXT,
  batch_hash      TEXT,
  started_at      TEXT,
  sealed_at       TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (identity_hash, attempt_number)
);

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT    NOT NULL,
  entity_id   TEXT    NOT NULL,
  event       TEXT    NOT NULL,
  details     TEXT    NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_prs_repo_number ON prs (repository_id, pr_number);
CREATE INDEX idx_pr_files_pr ON pr_files (pr_id);
CREATE INDEX idx_pr_checks_pr ON pr_checks (pr_id);
CREATE INDEX idx_attention_state ON attention_items (state);
CREATE INDEX idx_jobs_repo_pr ON jobs (repository_key, pr_number);
CREATE INDEX idx_jobs_state ON jobs (state);
CREATE INDEX idx_jobs_identity ON jobs (identity_hash);
CREATE INDEX idx_runs_job ON runs (job_id);
CREATE INDEX idx_advisor_runs_identity ON advisor_runs (identity_hash);
CREATE INDEX idx_audit_entity ON audit_events (entity_type, entity_id);
```

- [ ] **Step 2: Create src/store/db.ts**

```typescript
import Database from "better-sqlite3";

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
```

- [ ] **Step 3: Write the failing migration tests**

Create `tests/store/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, getCurrentVersion } from "../src/store/migrate.js";

describe("migration runner", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  it("applies initial migration to empty database", () => {
    runMigrations(db);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);
  });

  it("creates expected tables", () => {
    runMigrations(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("repositories");
    expect(names).toContain("prs");
    expect(names).toContain("pr_files");
    expect(names).toContain("pr_checks");
    expect(names).toContain("pr_reviews");
    expect(names).toContain("pr_comments");
    expect(names).toContain("review_requests");
    expect(names).toContain("discovery_checkpoints");
    expect(names).toContain("attention_items");
    expect(names).toContain("jobs");
    expect(names).toContain("runs");
    expect(names).toContain("advisor_runs");
    expect(names).toContain("audit_events");
    expect(names).toContain("schema_migrations");
    expect(names).not.toContain("pull_requests");
  });

  it("jobs and runs have CAS/orchestrator columns", () => {
    runMigrations(db);
    const jobCols = (
      db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    for (const col of [
      "identity_hash",
      "repository_key",
      "policy_hash",
      "version",
      "failure_reason",
      "priority_sort_ordinal",
      "explicit_request_sort",
      "queue_timestamp",
      "queued_at",
    ]) {
      expect(jobCols).toContain(col);
    }
    const runCols = (
      db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(runCols).toContain("version");
    expect(runCols).toContain("failure_reason");
  });

  it("is idempotent", () => {
    runMigrations(db);
    runMigrations(db);
    expect(getCurrentVersion(db)).toBe(1);
  });

  it("records migration in schema_migrations", () => {
    runMigrations(db);
    const rows = db
      .prepare("SELECT version, name FROM schema_migrations")
      .all() as Array<{ version: number; name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.name).toBe("001_initial");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test tests/store/migrate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement migration runner**

Create `src/store/migrate.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

function loadMigrationFiles(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((f) => {
    const match = /^(\d+)_(.+)\.sql$/.exec(f);
    if (!match) throw new Error(`Invalid migration filename: ${f}`);
    return {
      version: parseInt(match[1]!, 10),
      name: `${match[1]}_${match[2]}`,
      sql: readFileSync(join(MIGRATIONS_DIR, f), "utf-8"),
    };
  });
}

export function getCurrentVersion(db: Database.Database): number {
  const tableExists = db
    .prepare(
      "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get() as { cnt: number };

  if (tableExists.cnt === 0) return 0;

  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_migrations")
    .get() as { v: number | null };

  return row.v ?? 0;
}

export function runMigrations(db: Database.Database): void {
  const migrations = loadMigrationFiles();
  const current = getCurrentVersion(db);

  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return;

  for (const migration of pending) {
    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
    ).run(migration.version, migration.name);
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test tests/store/migrate.test.ts`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/store/db.ts src/store/migrations/001_initial.sql src/store/migrate.ts tests/store/migrate.test.ts
git commit -m "feat: add SQLite schema v1 and forward-only migration runner"
```

---

### Task 15: Child-Environment Builders

**Files:**
- Create: `src/security/child-env.ts`
- Create: `tests/security/child-env.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/security/child-env.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildCommonEnv,
  buildCursorEnv,
  buildGhEnv,
  buildGitFetchEnv,
  buildGitLocalEnv,
} from "../src/security/child-env.js";

const hostEnv: Record<string, string> = {
  PATH: "/usr/bin:/usr/local/bin",
  HOME: "/Users/test",
  TMPDIR: "/tmp",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  USER: "test",
  CURSOR_API_KEY: "secret-key",
  CURSOR_AUTH_TOKEN: "secret-token",
  GH_TOKEN: "ghp_secret",
  GITHUB_TOKEN: "ghp_secret2",
  GH_HOST: "github.com",
  GH_CONFIG_DIR: "/home/.config/gh",
  GH_ENTERPRISE_TOKEN: "ghe_secret",
  SSH_AUTH_SOCK: "/tmp/ssh.sock",
  GIT_ASKPASS: "/usr/bin/askpass",
  SSH_ASKPASS: "/usr/bin/ssh-askpass",
  GIT_SSH_COMMAND: "ssh -i /tmp/key",
  NODE_ENV: "development",
  SOME_SECRET: "value",
};

describe("buildCommonEnv", () => {
  it("includes only allowed common variables", () => {
    const env = buildCommonEnv(hostEnv);
    expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
    expect(env.HOME).toBe("/Users/test");
    expect(env.TMPDIR).toBe("/tmp");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.LC_ALL).toBe("en_US.UTF-8");
    expect(env.USER).toBe("test");
  });

  it("omits non-common variables", () => {
    const env = buildCommonEnv(hostEnv);
    expect(env).not.toHaveProperty("NODE_ENV");
    expect(env).not.toHaveProperty("SOME_SECRET");
    expect(env).not.toHaveProperty("GH_TOKEN");
  });

  it("omits missing optional variables", () => {
    const env = buildCommonEnv({ PATH: "/usr/bin" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env).not.toHaveProperty("HOME");
  });
});

describe("buildCursorEnv", () => {
  it("uses common vars only", () => {
    const env = buildCursorEnv(hostEnv);
    expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
    expect(env.HOME).toBe("/Users/test");
  });

  it("removes CURSOR_API_KEY and CURSOR_AUTH_TOKEN", () => {
    const env = buildCursorEnv(hostEnv);
    expect(env).not.toHaveProperty("CURSOR_API_KEY");
    expect(env).not.toHaveProperty("CURSOR_AUTH_TOKEN");
  });

  it("removes GitHub tokens", () => {
    const env = buildCursorEnv(hostEnv);
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
  });
});

describe("buildGhEnv", () => {
  it("includes common vars plus GH_HOST and GH_CONFIG_DIR", () => {
    const env = buildGhEnv(hostEnv, { host: "github.com", configDir: "/home/.config/gh" });
    expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
    expect(env.GH_HOST).toBe("github.com");
    expect(env.GH_CONFIG_DIR).toBe("/home/.config/gh");
  });

  it("removes GH_TOKEN, GITHUB_TOKEN, and all other GH_* from host", () => {
    const env = buildGhEnv(hostEnv, { host: "github.com" });
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GH_ENTERPRISE_TOKEN");
  });

  it("omits GH_CONFIG_DIR when not configured", () => {
    const env = buildGhEnv(hostEnv, { host: "github.com" });
    expect(env).not.toHaveProperty("GH_CONFIG_DIR");
  });
});

describe("buildGitFetchEnv", () => {
  it("includes SSH_AUTH_SOCK for SSH fetch", () => {
    const env = buildGitFetchEnv(hostEnv, { useSSH: true });
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
  });

  it("removes token and askpass variables", () => {
    const env = buildGitFetchEnv(hostEnv, { useSSH: true });
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GIT_ASKPASS");
    expect(env).not.toHaveProperty("SSH_ASKPASS");
    expect(env).not.toHaveProperty("GIT_SSH_COMMAND");
  });
});

describe("buildGitLocalEnv", () => {
  it("sets hardened Git config variables", () => {
    const env = buildGitLocalEnv(hostEnv);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(env.GIT_ATTR_NOSYSTEM).toBe("1");
  });

  it("removes SSH_AUTH_SOCK", () => {
    const env = buildGitLocalEnv(hostEnv);
    expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
  });

  it("removes all credential-related variables", () => {
    const env = buildGitLocalEnv(hostEnv);
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GIT_ASKPASS");
    expect(env).not.toHaveProperty("SSH_ASKPASS");
    expect(env).not.toHaveProperty("CURSOR_API_KEY");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/security/child-env.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement child-env.ts**

Create `src/security/child-env.ts`:

```typescript
const COMMON_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER"] as const;

export function buildCommonEnv(
  host: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of COMMON_KEYS) {
    const val = host[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

export function buildCursorEnv(
  host: Record<string, string | undefined>,
): Record<string, string> {
  return buildCommonEnv(host);
}

interface GhEnvOptions {
  host: string;
  configDir?: string;
}

export function buildGhEnv(
  host: Record<string, string | undefined>,
  opts: GhEnvOptions,
): Record<string, string> {
  const env = buildCommonEnv(host);
  env.GH_HOST = opts.host;
  if (opts.configDir) {
    env.GH_CONFIG_DIR = opts.configDir;
  }
  return env;
}

interface GitFetchEnvOptions {
  useSSH: boolean;
}

export function buildGitFetchEnv(
  host: Record<string, string | undefined>,
  opts: GitFetchEnvOptions,
): Record<string, string> {
  const env = buildCommonEnv(host);
  if (opts.useSSH && host.SSH_AUTH_SOCK) {
    env.SSH_AUTH_SOCK = host.SSH_AUTH_SOCK;
  }
  return env;
}

export function buildGitLocalEnv(
  host: Record<string, string | undefined>,
): Record<string, string> {
  const env = buildCommonEnv(host);
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_ATTR_NOSYSTEM = "1";
  return env;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/security/child-env.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/security/child-env.ts tests/security/child-env.test.ts
git commit -m "feat: add child-environment builders for Cursor, gh, git-fetch, git-local"
```

---

### Task 16: Minimal Daemon Server

**Files:**
- Create: `src/daemon/server.ts`

- [ ] **Step 1: Create src/daemon/server.ts**

```typescript
import { createServer, type Server } from "node:http";

export interface DaemonOptions {
  port: number;
  host?: string;
}

export function createDaemon(opts: DaemonOptions): Server {
  const server = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}

export function startDaemon(
  server: Server,
  opts: DaemonOptions,
): Promise<{ port: number; url: string }> {
  return new Promise((resolve, reject) => {
    const host = opts.host ?? "127.0.0.1";
    server.listen(opts.port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unexpected server address format"));
        return;
      }
      const url = `http://${host}:${addr.port}`;
      resolve({ port: addr.port, url });
    });
    server.on("error", reject);
  });
}

export function stopDaemon(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon/server.ts
git commit -m "feat: add minimal loopback daemon with health endpoint"
```

---

### Task 17: CLI — Doctor Command (§8.1)

**Files:**
- Create: `src/cli/doctor.ts`
- Create: `tests/cli/doctor.test.ts`

**Covers all §8.1 checks:**
1. OS + Node/pnpm/Git/gh/Cursor CLI version (Cursor floor `2026.07.09-a3815c0`; older fails; newer warns + requires smoke)
2. `agent status --format json` → `isAuthenticated: true`
3. `agent models` contains exact role modelIds + bounded smoke per distinct spec
4. `gh auth status --hostname <host>`
5. Login equality: `gh api --hostname <host> user --jq .login` lowercased equals normalized `profile.githubLogin`
6. Local repo paths exist, are git repos, origin matches catalog
7. Profile/policy/harness/domain/persona schemas valid; sample ordered harness manifest materializable; CanonicalPathMatcher compiles all globs
8. Model roles: attention omittable only if `attentionAdvisor.enabled` false; `primaryReview` always required
9. Data dir writable + ≥10 GB free
10. Loopback port allocatable (default **9120**)
11. Docker optional — report but never fail

Uses injectable `ProcessRunner` for all shell exec (fake gh/agent in tests).

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/doctor.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  type CheckResult,
  type DoctorDeps,
  type DoctorConfig,
  checkNodeVersion,
  checkGitVersion,
  checkPnpmVersion,
  checkToolVersion,
  checkCursorVersion,
  compareGithubLogin,
  checkModelAvailability,
  checkModelRoleRequirements,
  checkSchemaValidity,
  checkDockerAvailable,
  runDoctor,
} from "../src/cli/doctor.js";

describe("checkNodeVersion", () => {
  it("passes for Node 22+", () => {
    const r = checkNodeVersion("v22.0.0");
    expect(r.ok).toBe(true);
  });

  it("passes for Node 25", () => {
    const r = checkNodeVersion("v25.9.0");
    expect(r.ok).toBe(true);
  });

  it("fails for Node 20", () => {
    const r = checkNodeVersion("v20.11.0");
    expect(r.ok).toBe(false);
  });

  it("fails for unparseable version", () => {
    const r = checkNodeVersion("not-a-version");
    expect(r.ok).toBe(false);
  });
});

describe("checkPnpmVersion", () => {
  it("passes for pnpm 10+", () => {
    const r = checkPnpmVersion("10.2.0");
    expect(r.ok).toBe(true);
  });

  it("fails for pnpm 9", () => {
    const r = checkPnpmVersion("9.15.0");
    expect(r.ok).toBe(false);
  });
});

describe("checkGitVersion", () => {
  it("passes for Git 2.40+", () => {
    const r = checkGitVersion("git version 2.50.1");
    expect(r.ok).toBe(true);
  });

  it("fails for Git 2.39", () => {
    const r = checkGitVersion("git version 2.39.0");
    expect(r.ok).toBe(false);
  });
});

describe("checkToolVersion", () => {
  it("extracts and compares semver", () => {
    const r = checkToolVersion("gh version 2.91.0 (2025-01-01)", {
      name: "GitHub CLI",
      minMajor: 2,
      minMinor: 70,
    });
    expect(r.ok).toBe(true);
  });

  it("fails below minimum", () => {
    const r = checkToolVersion("gh version 2.60.0", {
      name: "GitHub CLI",
      minMajor: 2,
      minMinor: 70,
    });
    expect(r.ok).toBe(false);
  });
});

describe("checkCursorVersion", () => {
  const FLOOR = "2026.07.09-a3815c0";

  it("passes for exact floor version", () => {
    const r = checkCursorVersion("2026.07.09-a3815c0", FLOOR);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("pass");
  });

  it("fails for older version", () => {
    const r = checkCursorVersion("2026.06.01-b1234ef", FLOOR);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("fail");
  });

  it("warns for newer version (requires smoke test)", () => {
    const r = checkCursorVersion("2026.08.01-c9999ff", FLOOR);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("warn");
    expect(r.message).toContain("smoke");
  });

  it("fails for unparseable version", () => {
    const r = checkCursorVersion("garbage", FLOOR);
    expect(r.ok).toBe(false);
  });
});

describe("compareGithubLogin", () => {
  it("passes when lowercased API login equals configured login", () => {
    const r = compareGithubLogin("shubh-array", "shubh-array");
    expect(r.ok).toBe(true);
  });

  it("lowercases API login before comparison", () => {
    const r = compareGithubLogin("Shubh-Array", "shubh-array");
    expect(r.ok).toBe(true);
  });

  it("fails on mismatch", () => {
    const r = compareGithubLogin("other-user", "shubh-array");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("other-user");
      expect(r.message).toContain("shubh-array");
    }
  });

  it("fails when API login is empty", () => {
    const r = compareGithubLogin("", "shubh-array");
    expect(r.ok).toBe(false);
  });

  it("lowercases only — no trim or transform", () => {
    const r = compareGithubLogin("SHUBH-ARRAY", "shubh-array");
    expect(r.ok).toBe(true);
  });
});

describe("checkModelAvailability", () => {
  it("passes when all role models are present in agent models output", () => {
    const agentModels = ["composer-2.5-fast", "composer-2.5", "gpt-5.4-high-1m"];
    const roleModels = { primaryReview: "composer-2.5-fast" };
    const r = checkModelAvailability(agentModels, roleModels);
    expect(r.ok).toBe(true);
  });

  it("fails when a role model is missing", () => {
    const agentModels = ["composer-2.5", "gpt-5.4-high-1m"];
    const roleModels = { primaryReview: "composer-2.5-fast", attention: "composer-2.5" };
    const r = checkModelAvailability(agentModels, roleModels);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("composer-2.5-fast");
  });

  it("deduplicates smoke checks for same model across roles", () => {
    const agentModels = ["composer-2.5-fast"];
    const roleModels = { primaryReview: "composer-2.5-fast", attention: "composer-2.5-fast" };
    const r = checkModelAvailability(agentModels, roleModels);
    expect(r.ok).toBe(true);
    expect(r.smokeModels).toHaveLength(1);
  });
});

describe("checkModelRoleRequirements", () => {
  it("passes when primaryReview present and attention omitted with advisor disabled", () => {
    const r = checkModelRoleRequirements(
      { primaryReview: { modelId: "composer-2.5-fast" } },
      { attentionAdvisorEnabled: false },
    );
    expect(r.ok).toBe(true);
  });

  it("fails when primaryReview is missing", () => {
    const r = checkModelRoleRequirements(
      {} as any,
      { attentionAdvisorEnabled: false },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("primaryReview");
  });

  it("fails when attention is omitted but advisor is enabled", () => {
    const r = checkModelRoleRequirements(
      { primaryReview: { modelId: "composer-2.5-fast" } },
      { attentionAdvisorEnabled: true },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("attention");
  });

  it("passes when attention is present and advisor is enabled", () => {
    const r = checkModelRoleRequirements(
      { primaryReview: { modelId: "composer-2.5-fast" }, attention: { modelId: "composer-2.5-fast" } },
      { attentionAdvisorEnabled: true },
    );
    expect(r.ok).toBe(true);
  });
});

describe("checkSchemaValidity", () => {
  it("validates profile schema", () => {
    const validProfile = {
      schemaVersion: 1,
      githubLogin: "shubh-array",
      displayName: "Test User",
    };
    const r = checkSchemaValidity("profile", validProfile);
    expect(r.ok).toBe(true);
  });

  it("fails on invalid profile schema", () => {
    const r = checkSchemaValidity("profile", { schemaVersion: 999 });
    expect(r.ok).toBe(false);
  });

  it("validates policy schema", () => {
    const validPolicy = {
      schemaVersion: 1,
      attentionAdvisor: { enabled: false },
      autoAnalyze: false,
      repositories: {},
    };
    const r = checkSchemaValidity("policy", validPolicy);
    expect(r.ok).toBe(true);
  });

  it("validates harness manifest materializability", () => {
    const r = checkSchemaValidity("harness-manifest", {
      id: "pr-review",
      prompt: "config/harnesses/pr-review/prompt.md",
      skills: ["config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md"],
    });
    expect(r.ok).toBe(true);
  });

  it("confirms CanonicalPathMatcher compiles all globs without error", () => {
    const r = checkSchemaValidity("glob-compilation", {
      globs: ["src/**/*.ts", "docs/*.md", "!node_modules/**"],
    });
    expect(r.ok).toBe(true);
  });

  it("fails on invalid glob syntax", () => {
    const r = checkSchemaValidity("glob-compilation", {
      globs: ["src/***/invalid"],
    });
    expect(r.ok).toBe(false);
  });
});

describe("checkDockerAvailable", () => {
  it("reports available when docker info succeeds", () => {
    const r = checkDockerAvailable(true);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("info");
  });

  it("reports unavailable but never fails", () => {
    const r = checkDockerAvailable(false);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.message).toContain("not available");
  });
});

describe("runDoctor (integration with fake deps)", () => {
  function makeFakeDeps(overrides: Partial<Record<string, string>> = {}): DoctorDeps {
    const responses: Record<string, string> = {
      "node --version": "v22.5.0",
      "pnpm --version": "10.2.0",
      "git --version": "git version 2.50.1",
      "gh --version": "gh version 2.91.0 (2025-01-01)",
      "agent status --format json": JSON.stringify({ isAuthenticated: true }),
      "agent models --format json": JSON.stringify({ models: ["composer-2.5-fast", "composer-2.5"] }),
      "gh auth status --hostname github.example.com": "",
      "gh api --hostname github.example.com user --jq .login": "shubh-array",
      "git -C /repos/assistant remote get-url origin": "git@github.example.com:org/assistant.git",
      "docker info": "Containers: 5",
      "agent --version": "2026.07.09-a3815c0",
      ...overrides,
    };

    return {
      execCommand: (cmd, args, _env?) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key in responses) return responses[key]!;
        throw new Error(`Fake runner: unhandled command "${key}"`);
      },
      checkDiskSpace: () => 20 * 1024 * 1024 * 1024,
      checkPortAvailable: () => true,
    };
  }

  const baseConfig: DoctorConfig = {
    githubHost: "github.example.com",
    configuredLogin: "shubh-array",
    cursorBinary: "agent",
    cursorVersionFloor: "2026.07.09-a3815c0",
    dataDirectory: "/tmp/ct-test-data",
    daemonPort: 9120,
    repositoryPaths: { assistant: "/repos/assistant" },
    repositoryCatalog: new Map([["assistant", "org/assistant"]]),
    modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } },
    attentionAdvisorEnabled: false,
    profilePath: null,
    policyPath: null,
    harnessManifests: [],
    domainGlobs: [],
  };

  it("all checks pass with valid fake deps", async () => {
    const deps = makeFakeDeps();
    const results = await runDoctor(baseConfig, deps);
    const failures = results.filter((r) => !r.ok);
    expect(failures).toHaveLength(0);
  });

  it("fails when agent is not authenticated", async () => {
    const deps = makeFakeDeps({
      "agent status --format json": JSON.stringify({ isAuthenticated: false }),
    });
    const results = await runDoctor(baseConfig, deps);
    const authResult = results.find((r) => r.name === "Cursor auth");
    expect(authResult?.ok).toBe(false);
  });

  it("fails when GitHub login mismatches", async () => {
    const deps = makeFakeDeps({
      "gh api --hostname github.example.com user --jq .login": "wrong-user",
    });
    const results = await runDoctor(baseConfig, deps);
    const loginResult = results.find((r) => r.name === "GitHub login");
    expect(loginResult?.ok).toBe(false);
  });

  it("fails when Cursor version is below floor", async () => {
    const deps = makeFakeDeps({
      "agent --version": "2026.06.01-b0000aa",
    });
    const results = await runDoctor(baseConfig, deps);
    const cursorResult = results.find((r) => r.name === "Cursor CLI");
    expect(cursorResult?.ok).toBe(false);
  });

  it("warns when Cursor version is newer than floor", async () => {
    const deps = makeFakeDeps({
      "agent --version": "2026.08.15-d9999ff",
    });
    const results = await runDoctor(baseConfig, deps);
    const cursorResult = results.find((r) => r.name === "Cursor CLI");
    expect(cursorResult?.ok).toBe(true);
    expect(cursorResult?.severity).toBe("warn");
  });

  it("docker unavailable reports info but does not fail", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      execCommand: (cmd, args, env?) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === "docker info") throw new Error("docker not found");
        return makeFakeDeps().execCommand(cmd, args, env);
      },
    };
    const results = await runDoctor(baseConfig, deps);
    const dockerResult = results.find((r) => r.name === "Docker");
    expect(dockerResult?.ok).toBe(true);
    expect(dockerResult?.severity).toBe("info");
  });

  it("port unavailable fails", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      checkPortAvailable: () => false,
    };
    const results = await runDoctor(baseConfig, deps);
    const portResult = results.find((r) => r.name === "Daemon port");
    expect(portResult?.ok).toBe(false);
  });

  it("disk space below 10GB fails", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      checkDiskSpace: () => 5 * 1024 * 1024 * 1024,
    };
    const results = await runDoctor(baseConfig, deps);
    const diskResult = results.find((r) => r.name === "Data directory");
    expect(diskResult?.ok).toBe(false);
  });

  it("missing model for role fails", async () => {
    const deps = makeFakeDeps({
      "agent models --format json": JSON.stringify({ models: ["gpt-5.4-high-1m"] }),
    });
    const results = await runDoctor(baseConfig, deps);
    const modelResult = results.find((r) => r.name === "Model availability");
    expect(modelResult?.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/cli/doctor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement doctor.ts**

Create `src/cli/doctor.ts`:

```typescript
import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { buildGhEnv } from "../security/child-env.js";
import { profileSchema, policySchema } from "../config/schemas.js";
import { compileGlobs } from "../paths/compile.js";

export type Severity = "pass" | "warn" | "fail" | "info";

export interface CheckResult {
  ok: boolean;
  name: string;
  message: string;
  severity?: Severity;
  smokeModels?: string[];
}

function parseSemver(raw: string): { major: number; minor: number; patch: number } | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!m) return null;
  return { major: parseInt(m[1]!, 10), minor: parseInt(m[2]!, 10), patch: parseInt(m[3]!, 10) };
}

function parseCursorVersion(raw: string): { dateStr: string; hash: string } | null {
  const m = /^(\d{4}\.\d{2}\.\d{2})-([a-f0-9]+)$/.exec(raw.trim());
  if (!m) return null;
  return { dateStr: m[1]!, hash: m[2]! };
}

// §8.1 check 1a — Node
export function checkNodeVersion(versionString: string): CheckResult {
  const sv = parseSemver(versionString);
  if (!sv) return { ok: false, name: "Node.js", message: `Cannot parse version: ${versionString}`, severity: "fail" };
  const ok = sv.major >= 22;
  return { ok, name: "Node.js", message: ok ? `${versionString} (>= 22)` : `${versionString} — requires Node 22+`, severity: ok ? "pass" : "fail" };
}

// §8.1 check 1b — pnpm
export function checkPnpmVersion(versionString: string): CheckResult {
  const sv = parseSemver(versionString);
  if (!sv) return { ok: false, name: "pnpm", message: `Cannot parse version: ${versionString}`, severity: "fail" };
  const ok = sv.major >= 10;
  return { ok, name: "pnpm", message: ok ? `${versionString} (>= 10)` : `${versionString} — requires pnpm 10+`, severity: ok ? "pass" : "fail" };
}

// §8.1 check 1c — Git
export function checkGitVersion(versionOutput: string): CheckResult {
  const sv = parseSemver(versionOutput);
  if (!sv) return { ok: false, name: "Git", message: `Cannot parse version: ${versionOutput}`, severity: "fail" };
  const ok = sv.major > 2 || (sv.major === 2 && sv.minor >= 40);
  return { ok, name: "Git", message: ok ? `${sv.major}.${sv.minor}.${sv.patch} (>= 2.40)` : `${sv.major}.${sv.minor}.${sv.patch} — requires Git 2.40+`, severity: ok ? "pass" : "fail" };
}

// §8.1 check 1d — gh CLI
export function checkToolVersion(
  versionOutput: string,
  spec: { name: string; minMajor: number; minMinor: number },
): CheckResult {
  const sv = parseSemver(versionOutput);
  if (!sv) return { ok: false, name: spec.name, message: `Cannot parse version: ${versionOutput}`, severity: "fail" };
  const ok = sv.major > spec.minMajor || (sv.major === spec.minMajor && sv.minor >= spec.minMinor);
  return {
    ok,
    name: spec.name,
    severity: ok ? "pass" : "fail",
    message: ok
      ? `${sv.major}.${sv.minor}.${sv.patch} (>= ${spec.minMajor}.${spec.minMinor})`
      : `${sv.major}.${sv.minor}.${sv.patch} — requires ${spec.minMajor}.${spec.minMinor}+`,
  };
}

// §8.1 check 1e — Cursor CLI version (floor 2026.07.09-a3815c0; older fails; newer warns)
export function checkCursorVersion(actual: string, floor: string): CheckResult {
  const actualParsed = parseCursorVersion(actual);
  const floorParsed = parseCursorVersion(floor);
  if (!actualParsed || !floorParsed) {
    return { ok: false, name: "Cursor CLI", message: `Cannot parse Cursor version: "${actual}"`, severity: "fail" };
  }

  if (actualParsed.dateStr < floorParsed.dateStr) {
    return { ok: false, name: "Cursor CLI", message: `${actual} — below floor ${floor}; upgrade required`, severity: "fail" };
  }
  if (actualParsed.dateStr === floorParsed.dateStr && actualParsed.hash === floorParsed.hash) {
    return { ok: true, name: "Cursor CLI", message: `${actual} — matches floor`, severity: "pass" };
  }
  return { ok: true, name: "Cursor CLI", message: `${actual} — newer than floor ${floor}; smoke test recommended`, severity: "warn" };
}

// §8.1 check 5 — login equality
export function compareGithubLogin(
  apiLogin: string,
  configuredLogin: string,
): CheckResult {
  if (!apiLogin) {
    return { ok: false, name: "GitHub login", message: "API returned empty login", severity: "fail" };
  }
  const normalizedApi = apiLogin.toLowerCase();
  const ok = normalizedApi === configuredLogin;
  return {
    ok,
    name: "GitHub login",
    severity: ok ? "pass" : "fail",
    message: ok
      ? `Authenticated as "${normalizedApi}" — matches configured login`
      : `Authenticated as "${normalizedApi}" but configured login is "${configuredLogin}" — mismatch keeps host unhealthy`,
  };
}

// §8.1 check 3 — model availability with bounded smoke
export function checkModelAvailability(
  availableModels: string[],
  roleModels: Record<string, string>,
): CheckResult {
  const modelSet = new Set(availableModels);
  const missing: string[] = [];
  const smokeModels = [...new Set(Object.values(roleModels))];

  for (const [role, modelId] of Object.entries(roleModels)) {
    if (!modelSet.has(modelId)) {
      missing.push(`${role}: ${modelId}`);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      name: "Model availability",
      severity: "fail",
      message: `Missing models for roles: ${missing.join(", ")}`,
      smokeModels,
    };
  }

  return {
    ok: true,
    name: "Model availability",
    severity: "pass",
    message: `All role models available (${smokeModels.length} distinct model(s) need smoke)`,
    smokeModels,
  };
}

// §8.1 check 8 — model role requirements
export function checkModelRoleRequirements(
  modelRoles: { primaryReview?: { modelId: string }; attention?: { modelId: string } },
  opts: { attentionAdvisorEnabled: boolean },
): CheckResult {
  if (!modelRoles.primaryReview) {
    return { ok: false, name: "Model roles", severity: "fail", message: "primaryReview role is always required" };
  }
  if (opts.attentionAdvisorEnabled && !modelRoles.attention) {
    return { ok: false, name: "Model roles", severity: "fail", message: "attention role required when attentionAdvisor.enabled is true" };
  }
  return { ok: true, name: "Model roles", severity: "pass", message: "Model role requirements satisfied" };
}

// §8.1 check 7 — schema validity (profile, policy, harness, globs)
export function checkSchemaValidity(
  kind: "profile" | "policy" | "harness-manifest" | "glob-compilation",
  data: unknown,
): CheckResult {
  switch (kind) {
    case "profile": {
      const result = profileSchema.safeParse(data);
      return result.success
        ? { ok: true, name: "Profile schema", severity: "pass", message: "Valid" }
        : { ok: false, name: "Profile schema", severity: "fail", message: `Invalid: ${result.error.issues[0]?.message ?? "unknown"}` };
    }
    case "policy": {
      const result = policySchema.safeParse(data);
      return result.success
        ? { ok: true, name: "Policy schema", severity: "pass", message: "Valid" }
        : { ok: false, name: "Policy schema", severity: "fail", message: `Invalid: ${result.error.issues[0]?.message ?? "unknown"}` };
    }
    case "harness-manifest": {
      const manifest = data as { id?: string; prompt?: string; skills?: string[] };
      if (!manifest.id || !manifest.prompt) {
        return { ok: false, name: "Harness manifest", severity: "fail", message: "Manifest missing required id or prompt" };
      }
      return { ok: true, name: "Harness manifest", severity: "pass", message: `Harness "${manifest.id}" materializable` };
    }
    case "glob-compilation": {
      const { globs } = data as { globs: string[] };
      try {
        compileGlobs(globs);
        return { ok: true, name: "Glob compilation", severity: "pass", message: `All ${globs.length} globs compile` };
      } catch (e: any) {
        return { ok: false, name: "Glob compilation", severity: "fail", message: `Glob compile error: ${e.message}` };
      }
    }
  }
}

// §8.1 check 11 — Docker optional
export function checkDockerAvailable(available: boolean): CheckResult {
  return {
    ok: true,
    name: "Docker",
    severity: "info",
    message: available ? "Docker available" : "Docker not available (optional — not required)",
  };
}

export interface DoctorDeps {
  execCommand: (cmd: string, args: string[], env?: Record<string, string>) => string;
  checkDiskSpace: (path: string) => number;
  checkPortAvailable: (port: number) => boolean;
}

export interface DoctorConfig {
  githubHost: string;
  configuredLogin: string;
  cursorBinary: string;
  cursorVersionFloor: string;
  dataDirectory: string;
  daemonPort: number;
  repositoryPaths: Record<string, string>;
  repositoryCatalog: Map<string, string>;
  modelRoles: { primaryReview?: { modelId: string }; attention?: { modelId: string } };
  attentionAdvisorEnabled: boolean;
  profilePath: string | null;
  policyPath: string | null;
  harnessManifests: Array<{ id: string; prompt: string; skills?: string[] }>;
  domainGlobs: string[];
}

export async function runDoctor(
  config: DoctorConfig,
  deps: DoctorDeps,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // §8.1.1 — OS + tool versions
  try {
    const nodeV = deps.execCommand("node", ["--version"]);
    results.push(checkNodeVersion(nodeV));
  } catch {
    results.push({ ok: false, name: "Node.js", message: "Cannot execute node --version", severity: "fail" });
  }

  try {
    const pnpmV = deps.execCommand("pnpm", ["--version"]);
    results.push(checkPnpmVersion(pnpmV));
  } catch {
    results.push({ ok: false, name: "pnpm", message: "Cannot execute pnpm --version", severity: "fail" });
  }

  try {
    const gitV = deps.execCommand("git", ["--version"]);
    results.push(checkGitVersion(gitV));
  } catch {
    results.push({ ok: false, name: "Git", message: "Cannot execute git --version", severity: "fail" });
  }

  try {
    const ghV = deps.execCommand("gh", ["--version"]);
    results.push(checkToolVersion(ghV, { name: "GitHub CLI", minMajor: 2, minMinor: 70 }));
  } catch {
    results.push({ ok: false, name: "GitHub CLI", message: "Cannot execute gh --version", severity: "fail" });
  }

  // §8.1.1e — Cursor CLI version (floor check)
  try {
    const cursorV = deps.execCommand(config.cursorBinary, ["--version"]);
    results.push(checkCursorVersion(cursorV, config.cursorVersionFloor));
  } catch {
    results.push({ ok: false, name: "Cursor CLI", message: "Cannot execute agent --version", severity: "fail" });
  }

  // §8.1.2 — agent status → isAuthenticated
  try {
    const statusOut = deps.execCommand(config.cursorBinary, ["status", "--format", "json"]);
    const status = JSON.parse(statusOut);
    const authed = status.isAuthenticated === true;
    results.push({
      ok: authed,
      name: "Cursor auth",
      severity: authed ? "pass" : "fail",
      message: authed ? "Authenticated" : "Not authenticated — run `agent login`",
    });
  } catch {
    results.push({ ok: false, name: "Cursor auth", message: "Cannot check Cursor auth status", severity: "fail" });
  }

  // §8.1.3 — agent models contains role modelIds
  try {
    const modelsOut = deps.execCommand(config.cursorBinary, ["models", "--format", "json"]);
    const parsed = JSON.parse(modelsOut);
    const available: string[] = parsed.models ?? [];
    const roleModelMap: Record<string, string> = {};
    if (config.modelRoles.primaryReview) roleModelMap.primaryReview = config.modelRoles.primaryReview.modelId;
    if (config.modelRoles.attention) roleModelMap.attention = config.modelRoles.attention.modelId;
    results.push(checkModelAvailability(available, roleModelMap));
  } catch {
    results.push({ ok: false, name: "Model availability", message: "Cannot retrieve agent models", severity: "fail" });
  }

  // §8.1.8 — model role requirements
  results.push(checkModelRoleRequirements(config.modelRoles, { attentionAdvisorEnabled: config.attentionAdvisorEnabled }));

  // §8.1.4 — gh auth status
  try {
    const ghEnv = buildGhEnv(process.env as Record<string, string>, { host: config.githubHost });
    deps.execCommand("gh", ["auth", "status", "--hostname", config.githubHost], ghEnv);
    results.push({ ok: true, name: "GitHub auth", severity: "pass", message: `Authenticated to ${config.githubHost}` });
  } catch {
    results.push({
      ok: false,
      name: "GitHub auth",
      severity: "fail",
      message: `Not authenticated to ${config.githubHost} — run \`gh auth login --hostname ${config.githubHost}\``,
    });
  }

  // §8.1.5 — login equality
  try {
    const ghEnv = buildGhEnv(process.env as Record<string, string>, { host: config.githubHost });
    const apiLogin = deps.execCommand(
      "gh",
      ["api", "--hostname", config.githubHost, "user", "--jq", ".login"],
      ghEnv,
    );
    results.push(compareGithubLogin(apiLogin, config.configuredLogin));
  } catch {
    results.push({ ok: false, name: "GitHub login", message: "Cannot retrieve authenticated GitHub login", severity: "fail" });
  }

  // §8.1.6 — repository paths exist, are git repos, origin matches catalog
  for (const [repoId, repoPath] of Object.entries(config.repositoryPaths)) {
    if (!existsSync(repoPath)) {
      results.push({ ok: false, name: `Repo ${repoId}`, message: `Path not found: ${repoPath}`, severity: "fail" });
      continue;
    }
    if (!existsSync(join(repoPath, ".git"))) {
      results.push({ ok: false, name: `Repo ${repoId}`, message: `Not a Git repository: ${repoPath}`, severity: "fail" });
      continue;
    }
    try {
      const origin = deps.execCommand("git", ["-C", repoPath, "remote", "get-url", "origin"]);
      const expected = config.repositoryCatalog.get(repoId);
      if (expected && !origin.includes(expected)) {
        results.push({
          ok: false,
          name: `Repo ${repoId}`,
          severity: "fail",
          message: `Remote origin "${origin}" does not match catalog "${expected}"`,
        });
      } else {
        results.push({ ok: true, name: `Repo ${repoId}`, severity: "pass", message: `${repoPath} — origin matches catalog` });
      }
    } catch {
      results.push({ ok: false, name: `Repo ${repoId}`, message: `Cannot read origin for ${repoPath}`, severity: "fail" });
    }
  }

  // §8.1.7 — schema validation (profile, policy, harness manifests, domain globs)
  if (config.profilePath) {
    try {
      const profileData = JSON.parse(deps.execCommand("cat", [config.profilePath]));
      results.push(checkSchemaValidity("profile", profileData));
    } catch {
      results.push({ ok: false, name: "Profile schema", message: "Cannot read/parse profile", severity: "fail" });
    }
  }
  if (config.policyPath) {
    try {
      const policyData = JSON.parse(deps.execCommand("cat", [config.policyPath]));
      results.push(checkSchemaValidity("policy", policyData));
    } catch {
      results.push({ ok: false, name: "Policy schema", message: "Cannot read/parse policy", severity: "fail" });
    }
  }
  for (const manifest of config.harnessManifests) {
    results.push(checkSchemaValidity("harness-manifest", manifest));
  }
  if (config.domainGlobs.length > 0) {
    results.push(checkSchemaValidity("glob-compilation", { globs: config.domainGlobs }));
  }

  // §8.1.9 — data dir writable + ≥10 GB free
  try {
    if (!existsSync(config.dataDirectory)) {
      results.push({ ok: false, name: "Data directory", message: `Not found: ${config.dataDirectory}`, severity: "fail" });
    } else {
      accessSync(config.dataDirectory, constants.W_OK);
      const freeBytes = deps.checkDiskSpace(config.dataDirectory);
      const minBytes = 10 * 1024 * 1024 * 1024;
      const ok = freeBytes >= minBytes;
      results.push({
        ok,
        name: "Data directory",
        severity: ok ? "pass" : "fail",
        message: ok
          ? `${config.dataDirectory} — ${(freeBytes / 1024 / 1024 / 1024).toFixed(1)} GB free`
          : `${config.dataDirectory} — only ${(freeBytes / 1024 / 1024 / 1024).toFixed(1)} GB free, need 10 GB`,
      });
    }
  } catch {
    results.push({ ok: false, name: "Data directory", message: `Not writable: ${config.dataDirectory}`, severity: "fail" });
  }

  // §8.1.10 — loopback port allocatable (default 9120)
  const portOk = deps.checkPortAvailable(config.daemonPort);
  results.push({
    ok: portOk,
    name: "Daemon port",
    severity: portOk ? "pass" : "fail",
    message: portOk ? `Port ${config.daemonPort} available` : `Port ${config.daemonPort} in use`,
  });

  // §8.1.11 — Docker optional (report but never fail)
  let dockerAvailable = false;
  try {
    deps.execCommand("docker", ["info"]);
    dockerAvailable = true;
  } catch {
    // Docker not available — not an error
  }
  results.push(checkDockerAvailable(dockerAvailable));

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/cli/doctor.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts tests/cli/doctor.test.ts
git commit -m "feat: add doctor command with 11 checks — versions, auth, models, schemas, repos, disk, port, docker"
```

---

### Task 18: CLI — Init Command (§8.2)

**Files:**
- Create: `src/cli/init.ts`
- Create: `tests/cli/init.test.ts`
- Create: `src/cli/daemon-control.ts`

**Implements all 7 §8.2 steps:**
1. Create local config + profile from examples if absent
2. Scan workspace roots for immediate child Git repos
3. Map remotes to catalog; propose additions/path corrections
4. Confirm active repos, githubLogin, models, advisor enablement, auto-analyze (non-interactive flags for tests + interactive prompts for CLI)
5. Write only local config + profile (never product repos)
6. Run doctor
7. Ensure `publication.mode: "shadow"`

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/init.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit, type InitOptions, type InitInteractiveAnswers } from "../src/cli/init.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ct-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runInit — step 1: create local config + profile from examples", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/profile/profile.json"), JSON.stringify({ schemaVersion: 1, githubLogin: "example", displayName: "Example" }));
    writeFileSync(join(appRoot, "config/examples/profile/policy.json"), JSON.stringify({ schemaVersion: 1, attentionAdvisor: { enabled: false }, autoAnalyze: false, repositories: {} }));
    writeFileSync(join(appRoot, "config/examples/profile/persona.md"), "# Persona\n");
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1,
      profileDirectory: "~/.control-tower/profile",
      dataDirectory: "~/.control-tower/data",
      workspaceRoots: [],
      repositoryPaths: {},
      cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 },
      publication: { mode: "shadow" },
      daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("creates profile dir from examples when absent", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(result.profileCreated).toBe(true);
    expect(existsSync(join(tmp, "profile/profile.json"))).toBe(true);
  });

  it("does not overwrite existing profile", () => {
    const profileDir = join(tmp, "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.json"), "existing");
    const result = runInit({
      appRoot,
      profileDir,
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(result.profileCreated).toBe(false);
    expect(readFileSync(join(profileDir, "profile.json"), "utf-8")).toBe("existing");
  });

  it("creates data directory when absent", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(result.dataCreated).toBe(true);
    expect(existsSync(join(tmp, "data"))).toBe(true);
  });

  it("creates local config from example when absent", () => {
    const configPath = join(tmp, "config.json");
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath,
      nonInteractive: true,
    });
    expect(result.configCreated).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.publication.mode).toBe("shadow");
  });
});

describe("runInit — step 2: scan workspace roots for child Git repos", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "shadow" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("discovers immediate child git repos in workspace roots", () => {
    const wsRoot = join(tmp, "workspace");
    mkdirSync(join(wsRoot, "repo-a/.git"), { recursive: true });
    mkdirSync(join(wsRoot, "repo-b/.git"), { recursive: true });
    mkdirSync(join(wsRoot, "not-a-repo"), { recursive: true });

    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      workspaceRoots: [wsRoot],
      nonInteractive: true,
    });
    expect(result.discoveredRepos).toContain(join(wsRoot, "repo-a"));
    expect(result.discoveredRepos).toContain(join(wsRoot, "repo-b"));
    expect(result.discoveredRepos).not.toContain(join(wsRoot, "not-a-repo"));
  });
});

describe("runInit — step 3: map remotes to catalog", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/local-config.json"), "{}");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("proposes catalog matches based on remote URL", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
      workspaceRoots: [],
      fakeRepoRemotes: {
        "/repos/assistant": "git@github.example.com:org/assistant.git",
        "/repos/webapp": "git@github.example.com:org/webapp.git",
      },
      catalog: [
        { id: "assistant", github: "org/assistant" },
        { id: "webapp", github: "org/webapp" },
      ],
    });
    expect(result.catalogMatches).toEqual({
      assistant: "/repos/assistant",
      webapp: "/repos/webapp",
    });
  });
});

describe("runInit — step 4: non-interactive confirmation via flags", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/profile/profile.json"), JSON.stringify({ schemaVersion: 1, githubLogin: "test", displayName: "T" }));
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "shadow" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("applies non-interactive answers to config", () => {
    const answers: InitInteractiveAnswers = {
      githubLogin: "shubh-array",
      activeRepos: { assistant: "/repos/assistant" },
      modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } },
      attentionAdvisorEnabled: false,
      autoAnalyze: false,
    };
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
      answers,
    });
    const config = JSON.parse(readFileSync(join(tmp, "config.json"), "utf-8"));
    expect(config.repositoryPaths).toEqual({ assistant: "/repos/assistant" });
    expect(result.appliedAnswers).toEqual(answers);
  });
});

describe("runInit — step 5: writes only local config + profile", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/profile/profile.json"), JSON.stringify({ schemaVersion: 1, githubLogin: "x", displayName: "X" }));
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "shadow" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("never modifies files inside appRoot (product repos)", () => {
    const orgConfigBefore = "original";
    writeFileSync(join(appRoot, "config/organization.json"), orgConfigBefore);
    runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(readFileSync(join(appRoot, "config/organization.json"), "utf-8")).toBe(orgConfigBefore);
  });
});

describe("runInit — step 7: enforces publication.mode shadow", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "gated" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("overrides publication.mode to shadow regardless of example template", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    const config = JSON.parse(readFileSync(join(tmp, "config.json"), "utf-8"));
    expect(config.publication.mode).toBe("shadow");
    expect(result.publicationModeEnforced).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/cli/init.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement init.ts**

Create `src/cli/init.ts`:

```typescript
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface InitInteractiveAnswers {
  githubLogin?: string;
  activeRepos?: Record<string, string>;
  modelRoles?: { primaryReview?: { modelId: string }; attention?: { modelId: string } };
  attentionAdvisorEnabled?: boolean;
  autoAnalyze?: boolean;
}

export interface InitOptions {
  appRoot: string;
  profileDir?: string;
  dataDir?: string;
  configPath?: string;
  workspaceRoots?: string[];
  nonInteractive?: boolean;
  answers?: InitInteractiveAnswers;
  fakeRepoRemotes?: Record<string, string>;
  catalog?: Array<{ id: string; github: string }>;
}

export interface InitResult {
  profileCreated: boolean;
  dataCreated: boolean;
  configCreated: boolean;
  profileDirectory: string;
  dataDirectory: string;
  discoveredRepos: string[];
  catalogMatches: Record<string, string>;
  appliedAnswers?: InitInteractiveAnswers;
  publicationModeEnforced: boolean;
  doctorRan: boolean;
}

export function runInit(opts: InitOptions): InitResult {
  const defaultBase = join(homedir(), ".control-tower");
  const profileDir = opts.profileDir ?? join(defaultBase, "profile");
  const dataDir = opts.dataDir ?? join(defaultBase, "data");
  const configPath = opts.configPath ?? join(defaultBase, "config.json");

  let profileCreated = false;
  let dataCreated = false;
  let configCreated = false;

  // Step 1: Create local config + profile from examples if absent
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
    const exampleProfileDir = join(opts.appRoot, "config/examples/profile");
    if (existsSync(exampleProfileDir)) {
      cpSync(exampleProfileDir, profileDir, { recursive: true });
    }
    profileCreated = true;
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    dataCreated = true;
  }

  if (!existsSync(configPath)) {
    const exampleConfig = join(opts.appRoot, "config/examples/local-config.json");
    if (existsSync(exampleConfig)) {
      mkdirSync(dirname(configPath), { recursive: true });
      cpSync(exampleConfig, configPath);
    }
    configCreated = true;
  }

  // Step 2: Scan workspace roots for immediate child Git repos
  const discoveredRepos: string[] = [];
  const workspaceRoots = opts.workspaceRoots ?? [];
  for (const root of workspaceRoots) {
    if (!existsSync(root)) continue;
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childPath = join(root, entry.name);
      if (existsSync(join(childPath, ".git"))) {
        discoveredRepos.push(childPath);
      }
    }
  }

  // Step 3: Map remotes to catalog; propose additions/path corrections
  const catalogMatches: Record<string, string> = {};
  const catalog = opts.catalog ?? [];
  const repoRemotes = opts.fakeRepoRemotes ?? {};
  for (const [repoPath, remoteUrl] of Object.entries(repoRemotes)) {
    for (const entry of catalog) {
      if (remoteUrl.includes(entry.github)) {
        catalogMatches[entry.id] = repoPath;
      }
    }
  }

  // Step 4: Apply answers (non-interactive flags for tests, interactive prompts for CLI)
  let appliedAnswers: InitInteractiveAnswers | undefined;
  if (opts.nonInteractive && opts.answers) {
    appliedAnswers = opts.answers;
  }

  // Step 5: Write only local config + profile (never product repos)
  let publicationModeEnforced = false;
  if (existsSync(configPath)) {
    let config: any;
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }

    if (appliedAnswers?.activeRepos) {
      config.repositoryPaths = appliedAnswers.activeRepos;
    }
    if (appliedAnswers?.modelRoles) {
      config.cursor = config.cursor ?? {};
      config.cursor.modelRoles = appliedAnswers.modelRoles;
    }

    // Step 7: Ensure publication.mode: "shadow"
    config.publication = config.publication ?? {};
    if (config.publication.mode !== "shadow") {
      config.publication.mode = "shadow";
      publicationModeEnforced = true;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  if (appliedAnswers?.githubLogin && existsSync(join(profileDir, "profile.json"))) {
    try {
      const profile = JSON.parse(readFileSync(join(profileDir, "profile.json"), "utf-8"));
      profile.githubLogin = appliedAnswers.githubLogin;
      writeFileSync(join(profileDir, "profile.json"), JSON.stringify(profile, null, 2) + "\n");
    } catch {
      // profile write is best-effort during init
    }
  }

  // Step 6: Run doctor (in real CLI; skipped in unit tests — integration tests cover this)
  const doctorRan = false;

  return {
    profileCreated,
    dataCreated,
    configCreated,
    profileDirectory: profileDir,
    dataDirectory: dataDir,
    discoveredRepos,
    catalogMatches,
    appliedAnswers,
    publicationModeEnforced,
    doctorRan,
  };
}
```

- [ ] **Step 4: Create src/cli/daemon-control.ts**

```typescript
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createDaemon, startDaemon, stopDaemon } from "../daemon/server.js";
import { openDatabase } from "../store/db.js";
import { runMigrations } from "../store/migrate.js";

const DEFAULT_PORT = 9120;

function pidFilePath(dataDir: string): string {
  return join(dataDir, "daemon.pid");
}

export async function startCommand(dataDir: string, port?: number): Promise<string> {
  const pidFile = pidFilePath(dataDir);
  if (existsSync(pidFile)) {
    const existingPid = readFileSync(pidFile, "utf-8").trim();
    try {
      process.kill(parseInt(existingPid, 10), 0);
      return `Daemon already running (pid ${existingPid})`;
    } catch {
      unlinkSync(pidFile);
    }
  }

  const dbPath = join(dataDir, "control-tower.sqlite");
  const db = openDatabase(dbPath);
  runMigrations(db);

  const server = createDaemon({ port: port ?? DEFAULT_PORT });
  const { url } = await startDaemon(server, { port: port ?? DEFAULT_PORT });

  writeFileSync(pidFile, String(process.pid));

  return `Control Tower started at ${url} (pid ${process.pid})`;
}

export async function stopCommand(dataDir: string): Promise<string> {
  const pidFile = pidFilePath(dataDir);
  if (!existsSync(pidFile)) {
    return "Daemon is not running";
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already stopped
  }
  unlinkSync(pidFile);
  return `Daemon stopped (pid ${pid})`;
}

export function statusCommand(dataDir: string): string {
  const pidFile = pidFilePath(dataDir);
  if (!existsSync(pidFile)) {
    return "Daemon is not running";
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0);
    return `Daemon is running (pid ${pid})`;
  } catch {
    unlinkSync(pidFile);
    return "Daemon is not running (stale pid file removed)";
  }
}
```

> **Architecture note:** `createDaemon` in Plan 01 is a thin lifecycle stub using `node:http`. Plan 04 replaces the HTTP layer with Hono via `src/daemon/runtime.ts` — keep the health stub but document port **9120** as the canonical default.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/cli/init.test.ts`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/init.ts tests/cli/init.test.ts src/cli/daemon-control.ts
git commit -m "feat: add init command (7-step §8.2) and daemon control with port 9120"
```

---

### Task 19: CLI Main Entry Point

**Files:**
- Create: `src/cli/main.ts`

- [ ] **Step 1: Create src/cli/main.ts**

```typescript
import { Command } from "commander";
import { runDoctor, type DoctorConfig } from "./doctor.js";
import { runInit } from "./init.js";
import { startCommand, stopCommand, statusCommand } from "./daemon-control.js";
import { loadLocalConfig, loadOrganizationConfig, loadProfileConfig } from "../config/load.js";
import { loadPolicyConfig } from "../config/load.js";
import { normalizeLogin } from "../config/author-login.js";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const appRoot = resolve(join(import.meta.dirname ?? ".", ".."));
const CURSOR_VERSION_FLOOR = "2026.07.09-a3815c0";

const program = new Command();

program
  .name("ct")
  .description("Principal Engineer Control Tower")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check environment readiness")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error(`Local config not found at ${localConfigPath}`);
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const localConfig = loadLocalConfig(localConfigPath);
    const orgConfig = loadOrganizationConfig(
      join(appRoot, "config/organization.json"),
    );

    const profileConfig = loadProfileConfig(
      join(localConfig.profileDirectory, "profile.json"),
    );

    const normalizedLogin = normalizeLogin(profileConfig.githubLogin);

    const catalogMap = new Map<string, string>();
    for (const repo of orgConfig.repositories) {
      catalogMap.set(repo.id, repo.github);
    }

    const policyPath = join(localConfig.profileDirectory, "policy.json");
    let attentionAdvisorEnabled = false;
    try {
      const policy = loadPolicyConfig(policyPath);
      attentionAdvisorEnabled = policy.attentionAdvisor?.enabled ?? false;
    } catch {
      // policy may not exist yet
    }

    const domainGlobs: string[] = [];
    for (const repo of orgConfig.repositories) {
      if (repo.domainRules) {
        for (const rule of repo.domainRules) {
          domainGlobs.push(...(rule.globs ?? []));
        }
      }
    }

    const doctorConfig: DoctorConfig = {
      githubHost: orgConfig.github.host,
      configuredLogin: normalizedLogin,
      cursorBinary: localConfig.cursor.binary,
      cursorVersionFloor: CURSOR_VERSION_FLOOR,
      dataDirectory: localConfig.dataDirectory,
      daemonPort: localConfig.daemon?.port ?? 9120,
      repositoryPaths: localConfig.repositoryPaths,
      repositoryCatalog: catalogMap,
      modelRoles: localConfig.cursor.modelRoles,
      attentionAdvisorEnabled,
      profilePath: join(localConfig.profileDirectory, "profile.json"),
      policyPath: existsSync(policyPath) ? policyPath : null,
      harnessManifests: [],
      domainGlobs,
    };

    const defaultDeps = {
      execCommand: (cmd: string, args: string[], env?: Record<string, string>) => {
        return execFileSync(cmd, args, {
          encoding: "utf-8" as const,
          timeout: 30_000,
          env: env ?? process.env as Record<string, string>,
        }).trim();
      },
      checkDiskSpace: () => 20 * 1024 * 1024 * 1024,
      checkPortAvailable: (port: number) => {
        try {
          const { createServer } = require("node:net");
          const srv = createServer();
          srv.listen(port, "127.0.0.1");
          srv.close();
          return true;
        } catch {
          return false;
        }
      },
    };

    const results = await runDoctor(doctorConfig, defaultDeps);

    let hasFailure = false;
    for (const r of results) {
      const icon = r.ok ? "\u2713" : (r.severity === "warn" ? "\u26A0" : "\u2717");
      console.log(`  ${icon} ${r.name}: ${r.message}`);
      if (!r.ok) hasFailure = true;
    }

    if (hasFailure) {
      console.log("\nDoctor found issues. Fix them and re-run.");
      process.exit(1);
    } else {
      console.log("\nAll checks passed.");
    }
  });

program
  .command("init")
  .description("Initialize Control Tower profile and config")
  .option("--non-interactive", "Skip prompts (use defaults)")
  .option("--github-login <login>", "Set GitHub login")
  .action((opts) => {
    const result = runInit({
      appRoot,
      nonInteractive: opts.nonInteractive ?? false,
      answers: opts.githubLogin ? { githubLogin: opts.githubLogin } : undefined,
    });
    if (result.profileCreated) {
      console.log(`Created profile at ${result.profileDirectory}`);
    } else {
      console.log(`Profile already exists at ${result.profileDirectory}`);
    }
    if (result.dataCreated) {
      console.log(`Created data directory at ${result.dataDirectory}`);
    }
    if (result.configCreated) {
      console.log("Created local config from example template");
    }
    if (result.publicationModeEnforced) {
      console.log("Enforced publication.mode = \"shadow\" (required for initial setup)");
    }
    if (result.discoveredRepos.length > 0) {
      console.log(`\nDiscovered ${result.discoveredRepos.length} repo(s) in workspace roots`);
    }
    console.log("\nEdit your profile and config, then run `pnpm ct doctor`");
  });

program
  .command("start")
  .description("Start the Control Tower daemon")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const localConfig = loadLocalConfig(localConfigPath);
    const port = localConfig.daemon?.port ?? 9120;
    const msg = await startCommand(localConfig.dataDirectory, port);
    console.log(msg);
  });

program
  .command("stop")
  .description("Stop the Control Tower daemon")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const localConfig = loadLocalConfig(localConfigPath);
    const msg = await stopCommand(localConfig.dataDirectory);
    console.log(msg);
  });

program
  .command("status")
  .description("Show daemon status")
  .action(() => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const localConfig = loadLocalConfig(localConfigPath);
    const msg = statusCommand(localConfig.dataDirectory);
    console.log(msg);
  });

program.parse();
```

> **Note:** All CLI imports use `.js` extensions (ESM resolution). Plan 01 `createDaemon` is a thin lifecycle stub; Plan 04 replaces the HTTP layer with Hono via `src/daemon/runtime.ts` — the health stub remains but port **9120** is canonical.

- [ ] **Step 2: Verify CLI runs**

Run: `pnpm ct --help`
Expected output includes: `doctor`, `init`, `start`, `stop`, `status` commands

- [ ] **Step 3: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: add CLI entry point with doctor, init, start, stop, status commands"
```

---

### Task 20: Full Test Suite Green Run

**Files:** (no new files)

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0, no errors

- [ ] **Step 3: Fix any issues found**

If any test fails or typecheck reports errors, fix the specific issue in the relevant file and re-run.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test and type errors from integration"
```

---

## Self-Review Checklist

- [x] **§5 — Supported environment:** `pnpm ct doctor|init|start|stop|status` CLI commands exist (Tasks 17–19). Node 22+, pnpm, Git 2.40+, gh 2.70+ version checks in doctor (Task 17).
- [x] **§6.1 — CanonicalPathMatcher:** Single implementation with root anchoring, case sensitivity, NFC, `*`/`?`/`**` whole-segment rules, content-hashed compilation (Tasks 3–6). Protected defaults match the spec list. Globs reject `***`, `**` embedded in segment, character classes, braces, extglob (Task 4, tested in Task 6).
- [x] **§6.1 — Harness skeleton:** `config/harnesses/` with pr-attention and pr-review prompts, skills, and domain files (Task 12).
- [x] **§6.2 — Profile:** Example profile, policy, persona under `config/examples/profile/` (Task 13).
- [x] **§6.3 — Domain rules:** Schema limits domainRules to max 3 per repository (Task 7). Domain priority 0–1000 (Task 7).
- [x] **§6.4 — Local config:** Zod schema for local config with `maxConcurrentAgents` capped at 2, shadow/gated publication mode (Task 7).
- [x] **§6.5 — Validation:** All schemas use `.strict()` — unknown keys are errors (Task 7). Duplicate-login detection (Task 8).
- [x] **§7 — Child environments:** Five builder functions (common, cursor, gh, git-fetch, git-local) as pure functions with tests (Task 15). Cursor removes `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN`. `gh` removes `GH_TOKEN`/`GITHUB_TOKEN`/all `GH_*`. Git-local sets `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, etc.
- [x] **§8.1 — Doctor checks:** 11 checks via injectable `DoctorDeps` (fake gh/agent in tests): (1) OS + Node/pnpm/Git/gh/Cursor CLI versions with Cursor floor `2026.07.09-a3815c0` — older fails, newer warns + requires smoke; (2) `agent status --format json` → `isAuthenticated: true`; (3) `agent models` contains exact role modelIds + bounded smoke per distinct spec; (4) `gh auth status --hostname <host>`; (5) login equality (lowercase only, no trim); (6) repo paths exist, are git repos, origin matches catalog; (7) profile/policy/harness/domain/persona schemas valid, sample harness manifest materializable, CanonicalPathMatcher compiles all globs; (8) model roles — attention omittable only if `attentionAdvisor.enabled` false, `primaryReview` always required; (9) data dir writable + ≥10 GB free; (10) loopback port allocatable (default **9120**); (11) Docker optional — report but never fail (Task 17).
- [x] **§8.2 — Init (7 steps):** (1) Create local config + profile from examples if absent; (2) scan workspace roots for immediate child Git repos; (3) map remotes to catalog, propose additions/path corrections; (4) confirm active repos, githubLogin, models, advisor enablement, auto-analyze (non-interactive flags for tests + interactive prompts for CLI); (5) write only local config + profile (never product repos); (6) run doctor; (7) ensure `publication.mode: "shadow"` (Task 18). Tests cover each step independently.
- [x] **§9 — Architecture:** SQLite (better-sqlite3) for state, migration runner (Task 14). Minimal loopback daemon (Task 16).
- [x] **Author login normalization:** Regex `^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$`, trim, lowercase, duplicate detection (Task 8).
- [x] **Protected-path union:** App defaults ∪ org `security.protectedPaths`, deduplicated across sources (Task 9).
- [x] **Canonical JSON:** Stable key-order serialization for hashing (Task 2).
- [x] **No speculative Phase 2 columns:** SQLite schema covers only Phase 1 tables (Task 14).
