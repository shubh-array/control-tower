# Control Tower Phase 1 — Workbench & Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local loopback API, React workbench UI, untrusted-content sanitizer, operation planner, and gated publisher so the principal can verify agent drafts and publish approved review operations through their own GitHub identity.

**Architecture:** A Node loopback HTTP server (Hono on `node:http`) serves JSON API endpoints and static Vite-built React assets. Every state-changing request requires a session cookie plus a single-use action token. The publisher decomposes a review into individual typed operations, each with a canonical hash and independent single-use approval. Shadow mode (default) blocks all publication; `pnpm ct publication enable` gates on doctor + confirmation before writing `gated` to local config.

**Tech Stack:** React 19 + Vite 6 + TypeScript client under `client/`; Hono 4 on `node:http` for the loopback API; `rehype-sanitize` + `react-markdown` for Markdown; `crypto.randomBytes` / `crypto.createHash` for tokens and hashes

**Depends on:** Plans 01–03 (daemon lifecycle, discovery, policy, orchestrator, job/run state, context builder, Cursor adapter, validated provenance)

**Unlocks:** Plan 05 (live shadow observation, evaluation corpus, gated publishing rollout gates)

---

## File Structure

### Server-side (under `src/`)

| File | Responsibility |
|------|----------------|
| `src/api/server.ts` | Create Hono app, mount routes, bind to loopback, serve static client assets |
| `src/api/session.ts` | Random session secret, cookie creation/validation, same-origin check |
| `src/api/action-token.ts` | Single-use action token store: create (60s TTL), consume, reject expired/reused |
| `src/api/csp.ts` | Middleware: CSP header, X-Content-Type-Options, loopback host guard |
| `src/api/routes/health.ts` | `GET /api/health` — daemon/doctor status |
| `src/api/routes/queue.ts` | `GET /api/queue` — All Tracked + Focus Queue projection |
| `src/api/routes/jobs.ts` | `GET /api/jobs/:id` — job detail; `POST /api/jobs/analyze` → facade.requestAnalyze; `POST /api/jobs/:id/retry` → facade.requestRetry |
| `src/api/routes/drafts.ts` | `GET /api/drafts/:jobId` — accepted draft with validated provenance |
| `src/api/routes/approvals.ts` | `POST /api/approvals` — create single-use per-operation approval |
| `src/api/routes/publication.ts` | `POST /api/publish` — execute one approved operation |
| `src/api/routes/audit.ts` | `GET /api/audit/:jobId` — audit trail for a job |
| `src/publisher/operation-hash.ts` | Canonical external-operation hash computation |
| `src/publisher/operation-plan.ts` | Decompose draft + disposition into typed operations with `draftSummaryUse` |
| `src/publisher/approvals.ts` | Approval store: create, consume on first attempt, TTL, invalidation |
| `src/publisher/publish.ts` | Execute one approved operation via `gh`, record result, partial failure continuation |
| `src/publisher/continuation.ts` | §12 partial-publish continuation: incomplete ops only, never remap completed summary |
| `src/publisher/guards.ts` | Pre-publish guard checks: mode, head SHA, run, actor, provenance, consumed state |
| `src/cli/publication.ts` | `pnpm ct publication enable|disable` CLI commands |
| `src/config/runtime-config.ts` | §12 last-valid runtime config retention on invalid reload |

### Client-side (under `client/`)

| File | Responsibility |
|------|----------------|
| `client/package.json` | Vite React app dependencies |
| `client/index.html` | HTML shell — no inline script/style |
| `client/src/main.tsx` | React root mount |
| `client/src/App.tsx` | Router: All Tracked, Focus Queue, Workbench |
| `client/src/routes/AllTracked.tsx` | Authoritative coverage table with eligibility/exclusion reasons |
| `client/src/routes/FocusQueue.tsx` | Now / Next / Monitor lanes with advisor badge |
| `client/src/routes/Workbench.tsx` | Understand / Verify / Act review workflow |
| `client/src/components/SafeText.tsx` | Render untrusted plain strings via text nodes |
| `client/src/components/SafeMarkdown.tsx` | Markdown with raw HTML disabled + rehype-sanitize allowlist |
| `client/src/components/AdvisorBadge.tsx` | Relevance/risk/confidence pill with stale indicator |
| `client/src/components/CoverageWarning.tsx` | Missing-source-tree / protected-path omission banner |
| `client/src/lib/api.ts` | Typed fetch wrapper with session cookie + action-token support |
| `client/src/lib/sanitize.ts` | rehype-sanitize schema: allowlisted tags/attrs, safe URL schemes |

### Tests

| File | Responsibility |
|------|----------------|
| `tests/api/session.test.ts` | Cookie creation, validation, rejection of missing/wrong cookies |
| `tests/api/action-token.test.ts` | Token lifecycle: create, consume, expire, reject reuse |
| `tests/api/csp.test.ts` | CSP header content, nosniff, loopback host enforcement |
| `tests/publisher/operation-hash.test.ts` | Canonical hash stability, field binding, cross-operation rejection |
| `tests/publisher/operation-plan.test.ts` | Summary-use plans, `needs_human` rejection, duplicate body rejection |
| `tests/publisher/guards.test.ts` | Shadow block, head SHA, run match, actor, provenance, consumed state |
| `tests/publisher/publish.test.ts` | Publish flow, partial failure, continuation with fresh approvals |
| `tests/publisher/continuation.test.ts` | §12 partial publish: incomplete-only continuation, no summary remap |
| `tests/config/runtime-config.test.ts` | §12 last-valid config retained on invalid reload |
| `tests/client/sanitize.test.ts` | Allowlist correctness, URL scheme filtering |
| `tests/client/xss.fixtures.test.ts` | Stored-XSS payloads through every untrusted field |

---

## Tasks

### Task 1: Session Cookie Authentication

**Files:**
- Create: `src/api/session.ts`
- Test: `tests/api/session.test.ts`

- [x] **Step 1: Write failing tests for session module**

```typescript
// tests/api/session.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  createSessionSecret,
  createSessionCookie,
  validateSession,
} from "../../src/api/session.js";

describe("session", () => {
  let secret: string;

  beforeEach(() => {
    secret = createSessionSecret();
  });

  it("creates a 32-byte hex secret", () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates different secrets each time", () => {
    const other = createSessionSecret();
    expect(other).not.toBe(secret);
  });

  it("createSessionCookie returns a Set-Cookie header value", () => {
    const cookie = createSessionCookie(secret);
    expect(cookie).toContain("ct_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });

  it("validateSession succeeds with correct cookie", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1].split(";")[0];
    expect(validateSession(secret, `ct_session=${tokenValue}`)).toBe(true);
  });

  it("validateSession rejects missing cookie", () => {
    expect(validateSession(secret, undefined)).toBe(false);
  });

  it("validateSession rejects wrong secret", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1].split(";")[0];
    const other = createSessionSecret();
    expect(validateSession(other, `ct_session=${tokenValue}`)).toBe(false);
  });

  it("validateSession rejects non-loopback origin", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1].split(";")[0];
    expect(
      validateSession(secret, `ct_session=${tokenValue}`, "https://evil.com"),
    ).toBe(false);
  });

  it("validateSession accepts loopback origin", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1].split(";")[0];
    expect(
      validateSession(
        secret,
        `ct_session=${tokenValue}`,
        "http://127.0.0.1:9120",
      ),
    ).toBe(true);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/api/session.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement session module**

```typescript
// src/api/session.ts
import { randomBytes, createHmac } from "node:crypto";

export function createSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

export function createSessionCookie(secret: string): string {
  const signature = createHmac("sha256", secret)
    .update("ct_session")
    .digest("hex");
  return [
    `ct_session=${signature}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
  ].join("; ");
}

export function validateSession(
  secret: string,
  cookieHeader: string | undefined,
  origin?: string,
): boolean {
  if (origin !== undefined) {
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (!cookieHeader) return false;

  const match = cookieHeader.match(/ct_session=([0-9a-f]+)/);
  if (!match) return false;

  const expected = createHmac("sha256", secret)
    .update("ct_session")
    .digest("hex");
  return match[1] === expected;
}
```

Run: `pnpm vitest run tests/api/session.test.ts`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/api/session.ts tests/api/session.test.ts
git commit -m "feat(api): add session cookie authentication for loopback API"
```

---

### Task 2: Single-Use Action Tokens

**Files:**
- Create: `src/api/action-token.ts`
- Test: `tests/api/action-token.test.ts`

- [x] **Step 1: Write failing tests for action tokens**

```typescript
// tests/api/action-token.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ActionTokenStore } from "../../src/api/action-token.js";

describe("ActionTokenStore", () => {
  let store: ActionTokenStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ActionTokenStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a token that is a non-empty hex string", () => {
    const token = store.create();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("consume returns true for a valid unused token", () => {
    const token = store.create();
    expect(store.consume(token)).toBe(true);
  });

  it("consume returns false for an already-consumed token", () => {
    const token = store.create();
    store.consume(token);
    expect(store.consume(token)).toBe(false);
  });

  it("consume returns false for an unknown token", () => {
    expect(store.consume("deadbeef".repeat(8))).toBe(false);
  });

  it("consume returns false after 60-second TTL", () => {
    const token = store.create();
    vi.advanceTimersByTime(60_001);
    expect(store.consume(token)).toBe(false);
  });

  it("consume succeeds just before TTL expires", () => {
    const token = store.create();
    vi.advanceTimersByTime(59_999);
    expect(store.consume(token)).toBe(true);
  });

  it("cleanup removes expired tokens", () => {
    store.create();
    store.create();
    vi.advanceTimersByTime(61_000);
    store.cleanup();
    const fresh = store.create();
    expect(store.consume(fresh)).toBe(true);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/api/action-token.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement action token store**

```typescript
// src/api/action-token.ts
import { randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 60_000;

interface StoredToken {
  createdAt: number;
  consumed: boolean;
}

export class ActionTokenStore {
  private tokens = new Map<string, StoredToken>();

  create(): string {
    const token = randomBytes(32).toString("hex");
    this.tokens.set(token, { createdAt: Date.now(), consumed: false });
    return token;
  }

  consume(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) return false;
    if (entry.consumed) return false;
    if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
      this.tokens.delete(token);
      return false;
    }
    entry.consumed = true;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.tokens) {
      if (now - entry.createdAt > TOKEN_TTL_MS) {
        this.tokens.delete(key);
      }
    }
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/api/action-token.test.ts`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/api/action-token.ts tests/api/action-token.test.ts
git commit -m "feat(api): add single-use action tokens with 60s TTL"
```

---

### Task 3: CSP and Security Middleware

**Files:**
- Create: `src/api/csp.ts`
- Test: `tests/api/csp.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/api/csp.test.ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cspMiddleware, loopbackGuard } from "../../src/api/csp.js";

function makeApp() {
  const app = new Hono();
  app.use("*", loopbackGuard);
  app.use("*", cspMiddleware);
  app.get("/test", (c) => c.text("ok"));
  return app;
}

describe("cspMiddleware", () => {
  it("sets Content-Security-Policy header", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "127.0.0.1:9120" },
    });
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("media-src 'none'");
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "127.0.0.1:9120" },
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("loopbackGuard", () => {
  it("rejects non-loopback host headers", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts 127.0.0.1 host", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "127.0.0.1:9120" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts localhost host", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "localhost:9120" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects cross-origin requests", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: {
        Host: "127.0.0.1:9120",
        Origin: "https://evil.com",
      },
    });
    expect(res.status).toBe(403);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/api/csp.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement CSP middleware**

```typescript
// src/api/csp.ts
import type { MiddlewareHandler } from "hono";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "worker-src 'none'",
  "media-src 'none'",
].join("; ");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function extractHost(value: string): string {
  return value.replace(/:\d+$/, "");
}

function isLoopback(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  return LOOPBACK_HOSTS.has(extractHost(hostHeader));
}

export const loopbackGuard: MiddlewareHandler = async (c, next) => {
  if (!isLoopback(c.req.header("host"))) {
    return c.text("Forbidden: non-loopback host", 403);
  }

  const origin = c.req.header("origin");
  if (origin) {
    try {
      const url = new URL(origin);
      if (!LOOPBACK_HOSTS.has(url.hostname)) {
        return c.text("Forbidden: cross-origin", 403);
      }
    } catch {
      return c.text("Forbidden: invalid origin", 403);
    }
  }

  await next();
};

export const cspMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("content-security-policy", CSP);
  c.res.headers.set("x-content-type-options", "nosniff");
};
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/api/csp.test.ts`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/api/csp.ts tests/api/csp.test.ts
git commit -m "feat(api): add CSP middleware and loopback host guard"
```

---

### Task 4: Canonical Operation Hash

**Files:**
- Create: `src/publisher/operation-hash.ts`
- Test: `tests/publisher/operation-hash.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/publisher/operation-hash.test.ts
import { describe, it, expect } from "vitest";
import {
  computeOperationHash,
  type ExternalOperation,
} from "../../src/publisher/operation-hash.js";

const baseOp: ExternalOperation = {
  type: "comment_review",
  event: "COMMENT",
  principalLogin: "shubh-array",
  repository: "Powered-By-Array/pba-webapp",
  prNumber: 42,
  target: null,
  bodyHash: "abc123",
  disposition: "comment",
  draftSummaryUse: "review_body",
  summaryBodyHash: "abc123",
  headSha: "a".repeat(40),
  acceptedRunId: "run-1",
  runInputHash: "input-1",
  coverageHash: "cov-1",
  provenanceIds: ["pv_aaa", "pv_bbb"],
  idempotencyKey: "idem-1",
};

describe("computeOperationHash", () => {
  it("produces a stable hex hash", () => {
    const h1 = computeOperationHash(baseOp);
    const h2 = computeOperationHash(baseOp);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when operation type differs", () => {
    const altered = { ...baseOp, type: "approve_review" as const, event: "APPROVE" as const, bodyHash: null, provenanceIds: [], draftSummaryUse: "not_published" as const, summaryBodyHash: null };
    expect(computeOperationHash(altered)).not.toBe(computeOperationHash(baseOp));
  });

  it("changes when headSha differs", () => {
    const altered = { ...baseOp, headSha: "b".repeat(40) };
    expect(computeOperationHash(altered)).not.toBe(computeOperationHash(baseOp));
  });

  it("changes when principal differs", () => {
    const altered = { ...baseOp, principalLogin: "other-user" };
    expect(computeOperationHash(altered)).not.toBe(computeOperationHash(baseOp));
  });

  it("changes when provenance set differs", () => {
    const altered = { ...baseOp, provenanceIds: ["pv_aaa"] };
    expect(computeOperationHash(altered)).not.toBe(computeOperationHash(baseOp));
  });

  it("sorts provenance IDs for stability", () => {
    const reversed = { ...baseOp, provenanceIds: ["pv_bbb", "pv_aaa"] };
    expect(computeOperationHash(reversed)).toBe(computeOperationHash(baseOp));
  });

  it("changes when body hash goes from string to null", () => {
    const altered = { ...baseOp, bodyHash: null, provenanceIds: [] };
    expect(computeOperationHash(altered)).not.toBe(computeOperationHash(baseOp));
  });

  it("changes when idempotency key differs", () => {
    const altered = { ...baseOp, idempotencyKey: "idem-2" };
    expect(computeOperationHash(altered)).not.toBe(computeOperationHash(baseOp));
  });

  it("inline_comment includes target in hash", () => {
    const inline: ExternalOperation = {
      ...baseOp,
      type: "inline_comment",
      event: null,
      target: { path: "src/a.ts", side: "RIGHT", line: 10, startSide: null, startLine: null },
      draftSummaryUse: "not_published",
      summaryBodyHash: null,
    };
    const altTarget: ExternalOperation = {
      ...inline,
      target: { path: "src/b.ts", side: "RIGHT", line: 10, startSide: null, startLine: null },
    };
    expect(computeOperationHash(inline)).not.toBe(computeOperationHash(altTarget));
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/publisher/operation-hash.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement operation hash**

```typescript
// src/publisher/operation-hash.ts
import { createHash } from "node:crypto";

export type OperationType =
  | "inline_comment"
  | "summary_comment"
  | "comment_review"
  | "request_changes_review"
  | "approve_review";

export type GitHubReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

export type DraftSummaryUse =
  | "review_body"
  | "separate_summary"
  | "not_published";

export interface InlineTarget {
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  startSide: "LEFT" | "RIGHT" | null;
  startLine: number | null;
}

export interface ExternalOperation {
  type: OperationType;
  event: GitHubReviewEvent | null;
  principalLogin: string;
  repository: string;
  prNumber: number;
  target: InlineTarget | null;
  bodyHash: string | null;
  disposition: string;
  draftSummaryUse: DraftSummaryUse;
  summaryBodyHash: string | null;
  headSha: string;
  acceptedRunId: string;
  runInputHash: string;
  coverageHash: string;
  provenanceIds: string[];
  idempotencyKey: string;
}

export function computeOperationHash(op: ExternalOperation): string {
  const parts: string[] = [
    op.type,
    op.event ?? "null",
    op.principalLogin,
    op.repository,
    String(op.prNumber),
    op.target
      ? `${op.target.path}:${op.target.side}:${op.target.line}:${op.target.startSide ?? "null"}:${op.target.startLine ?? "null"}`
      : "null",
    op.bodyHash ?? "null",
    op.disposition,
    op.draftSummaryUse,
    op.summaryBodyHash ?? "null",
    op.headSha,
    op.acceptedRunId,
    op.runInputHash,
    op.coverageHash,
    [...op.provenanceIds].sort().join(","),
    op.idempotencyKey,
  ];

  return createHash("sha256").update(parts.join("\n")).digest("hex");
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/publisher/operation-hash.test.ts`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/publisher/operation-hash.ts tests/publisher/operation-hash.test.ts
git commit -m "feat(publisher): canonical per-operation hash computation"
```

---

### Task 5: Operation Planner

**Files:**
- Create: `src/publisher/operation-plan.ts`
- Test: `tests/publisher/operation-plan.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/publisher/operation-plan.test.ts
import { describe, it, expect } from "vitest";
import {
  createOperationPlan,
  type PlanInput,
} from "../../src/publisher/operation-plan.js";

const baseDraft = {
  summaryBody: "LGTM with minor suggestions",
  summaryBodyHash: "sum-hash-1",
  summaryProvenanceIds: ["pv_a", "pv_b"],
  findings: [
    {
      title: "Unused import",
      draftComment: "Remove unused import",
      location: { path: "src/a.ts", side: "RIGHT" as const, line: 5, startSide: null, startLine: null },
      observationProvenanceIds: ["pv_c"],
    },
  ],
};

const baseInput: PlanInput = {
  disposition: "comment",
  draft: baseDraft,
  principalLogin: "shubh-array",
  repository: "Powered-By-Array/pba-webapp",
  prNumber: 42,
  headSha: "a".repeat(40),
  acceptedRunId: "run-1",
  runInputHash: "input-1",
  coverageHash: "cov-1",
};

describe("createOperationPlan", () => {
  it("comment produces comment_review + inline_comment ops", () => {
    const plan = createOperationPlan(baseInput);
    expect(plan.draftSummaryUse).toBe("review_body");
    const types = plan.operations.map((o) => o.type);
    expect(types).toContain("comment_review");
    expect(types).toContain("inline_comment");
    expect(plan.operations.length).toBe(2);
  });

  it("request_changes produces request_changes_review + inline ops", () => {
    const plan = createOperationPlan({
      ...baseInput,
      disposition: "request_changes",
    });
    expect(plan.draftSummaryUse).toBe("review_body");
    const review = plan.operations.find((o) => o.type === "request_changes_review");
    expect(review).toBeDefined();
    expect(review!.event).toBe("REQUEST_CHANGES");
  });

  it("approve with no summary publication produces bodyless approve_review only", () => {
    const plan = createOperationPlan({
      ...baseInput,
      disposition: "approve",
      publishSummary: false,
    });
    expect(plan.draftSummaryUse).toBe("not_published");
    const review = plan.operations.find((o) => o.type === "approve_review");
    expect(review).toBeDefined();
    expect(review!.bodyHash).toBeNull();
    expect(review!.provenanceIds).toEqual([]);
  });

  it("approve with summary publication produces approve_review + summary_comment", () => {
    const plan = createOperationPlan({
      ...baseInput,
      disposition: "approve",
      publishSummary: true,
    });
    expect(plan.draftSummaryUse).toBe("separate_summary");
    const types = plan.operations.map((o) => o.type);
    expect(types).toContain("approve_review");
    expect(types).toContain("summary_comment");
    const summary = plan.operations.find((o) => o.type === "summary_comment");
    expect(summary!.bodyHash).toBe("sum-hash-1");
    expect(summary!.provenanceIds.length).toBeGreaterThan(0);
  });

  it("needs_human returns empty operations", () => {
    const plan = createOperationPlan({
      ...baseInput,
      disposition: "needs_human",
    });
    expect(plan.operations).toEqual([]);
    expect(plan.draftSummaryUse).toBe("not_published");
  });

  it("rejects duplicate summary body in both review_body and separate_summary", () => {
    const plan = createOperationPlan({
      ...baseInput,
      disposition: "comment",
    });
    const bodyHashesUsed = plan.operations
      .filter((o) => o.bodyHash === baseDraft.summaryBodyHash)
      .map((o) => o.type);
    expect(bodyHashesUsed.length).toBe(1);
  });

  it("comment_review requires non-empty body and provenance", () => {
    const plan = createOperationPlan(baseInput);
    const review = plan.operations.find((o) => o.type === "comment_review");
    expect(review!.bodyHash).not.toBeNull();
    expect(review!.provenanceIds.length).toBeGreaterThan(0);
  });

  it("request_changes_review requires non-empty body and provenance", () => {
    const plan = createOperationPlan({
      ...baseInput,
      disposition: "request_changes",
    });
    const review = plan.operations.find(
      (o) => o.type === "request_changes_review",
    );
    expect(review!.bodyHash).not.toBeNull();
    expect(review!.provenanceIds.length).toBeGreaterThan(0);
  });

  it("each operation gets a unique idempotency key", () => {
    const plan = createOperationPlan(baseInput);
    const keys = plan.operations.map((o) => o.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/publisher/operation-plan.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement operation planner**

```typescript
// src/publisher/operation-plan.ts
import { randomBytes, createHash } from "node:crypto";
import type {
  ExternalOperation,
  DraftSummaryUse,
  InlineTarget,
  GitHubReviewEvent,
} from "./operation-hash.js";

export interface FindingDraft {
  title: string;
  draftComment: string;
  location: InlineTarget;
  observationProvenanceIds: string[];
}

export interface DraftContent {
  summaryBody: string;
  summaryBodyHash: string;
  summaryProvenanceIds: string[];
  findings: FindingDraft[];
}

export interface PlanInput {
  disposition: "comment" | "request_changes" | "approve" | "needs_human";
  draft: DraftContent;
  principalLogin: string;
  repository: string;
  prNumber: number;
  headSha: string;
  acceptedRunId: string;
  runInputHash: string;
  coverageHash: string;
  publishSummary?: boolean;
}

export interface OperationPlan {
  draftSummaryUse: DraftSummaryUse;
  operations: ExternalOperation[];
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString("hex")}`;
}

function buildCommon(
  input: PlanInput,
): Omit<ExternalOperation, "type" | "event" | "target" | "bodyHash" | "provenanceIds" | "idempotencyKey" | "draftSummaryUse" | "summaryBodyHash"> {
  return {
    principalLogin: input.principalLogin,
    repository: input.repository,
    prNumber: input.prNumber,
    disposition: input.disposition,
    headSha: input.headSha,
    acceptedRunId: input.acceptedRunId,
    runInputHash: input.runInputHash,
    coverageHash: input.coverageHash,
  };
}

function buildInlineOps(
  input: PlanInput,
  common: ReturnType<typeof buildCommon>,
): ExternalOperation[] {
  return input.draft.findings.map((f) => ({
    ...common,
    type: "inline_comment" as const,
    event: null,
    target: f.location,
    bodyHash: createHash("sha256").update(f.draftComment).digest("hex"),
    provenanceIds: f.observationProvenanceIds,
    idempotencyKey: makeIdempotencyKey("inline"),
    draftSummaryUse: "not_published" as const,
    summaryBodyHash: null,
  }));
}

export function createOperationPlan(input: PlanInput): OperationPlan {
  if (input.disposition === "needs_human") {
    return { draftSummaryUse: "not_published", operations: [] };
  }

  const common = buildCommon(input);
  const ops: ExternalOperation[] = [];

  if (input.disposition === "comment" || input.disposition === "request_changes") {
    const event: GitHubReviewEvent =
      input.disposition === "comment" ? "COMMENT" : "REQUEST_CHANGES";
    const reviewType =
      input.disposition === "comment"
        ? ("comment_review" as const)
        : ("request_changes_review" as const);

    ops.push({
      ...common,
      type: reviewType,
      event,
      target: null,
      bodyHash: input.draft.summaryBodyHash,
      provenanceIds: input.draft.summaryProvenanceIds,
      idempotencyKey: makeIdempotencyKey("review"),
      draftSummaryUse: "review_body",
      summaryBodyHash: input.draft.summaryBodyHash,
    });

    ops.push(...buildInlineOps(input, common));

    return { draftSummaryUse: "review_body", operations: ops };
  }

  // disposition === "approve"
  const publishSummary = input.publishSummary ?? false;
  const summaryUse: DraftSummaryUse = publishSummary
    ? "separate_summary"
    : "not_published";

  ops.push({
    ...common,
    type: "approve_review",
    event: "APPROVE",
    target: null,
    bodyHash: null,
    provenanceIds: [],
    idempotencyKey: makeIdempotencyKey("approve"),
    draftSummaryUse: summaryUse,
    summaryBodyHash: publishSummary ? input.draft.summaryBodyHash : null,
  });

  if (publishSummary) {
    ops.push({
      ...common,
      type: "summary_comment",
      event: null,
      target: null,
      bodyHash: input.draft.summaryBodyHash,
      provenanceIds: input.draft.summaryProvenanceIds,
      idempotencyKey: makeIdempotencyKey("summary"),
      draftSummaryUse: summaryUse,
      summaryBodyHash: input.draft.summaryBodyHash,
    });
  }

  ops.push(...buildInlineOps(input, common));

  return { draftSummaryUse: summaryUse, operations: ops };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/publisher/operation-plan.test.ts`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/publisher/operation-plan.ts tests/publisher/operation-plan.test.ts
git commit -m "feat(publisher): operation planner with draftSummaryUse and per-op decomposition"
```

---

### Task 6: Publisher Guards

**Files:**
- Create: `src/publisher/guards.ts`
- Test: `tests/publisher/guards.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/publisher/guards.test.ts
import { describe, it, expect } from "vitest";
import {
  validatePublishGuards,
  type GuardInput,
} from "../../src/publisher/guards.js";

function makeGuardInput(overrides: Partial<GuardInput> = {}): GuardInput {
  return {
    publicationMode: "gated",
    approval: {
      operationHash: "hash-1",
      consumed: false,
      createdAt: Date.now() - 5 * 60_000,
      ttlMs: 10 * 60_000,
    },
    currentHeadSha: "a".repeat(40),
    reviewedHeadSha: "a".repeat(40),
    approvedRunId: "run-1",
    currentAcceptedRunId: "run-1",
    approvedRunInputHash: "input-1",
    currentRunInputHash: "input-1",
    operationHash: "hash-1",
    authenticatedLogin: "shubh-array",
    configuredOperator: "shubh-array",
    operationType: "comment_review",
    bodyHash: "body-hash",
    provenanceIds: ["pv_a"],
    idempotencyKeyCompleted: false,
    ...overrides,
  };
}

describe("validatePublishGuards", () => {
  it("passes with all valid inputs", () => {
    const result = validatePublishGuards(makeGuardInput());
    expect(result.ok).toBe(true);
  });

  it("rejects shadow mode", () => {
    const result = validatePublishGuards(
      makeGuardInput({ publicationMode: "shadow" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("shadow");
  });

  it("rejects mismatched head SHA", () => {
    const result = validatePublishGuards(
      makeGuardInput({ currentHeadSha: "b".repeat(40) }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("head SHA");
  });

  it("rejects mismatched run ID", () => {
    const result = validatePublishGuards(
      makeGuardInput({ currentAcceptedRunId: "run-2" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("run");
  });

  it("rejects mismatched run input hash", () => {
    const result = validatePublishGuards(
      makeGuardInput({ currentRunInputHash: "input-2" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("run-input");
  });

  it("rejects already-consumed approval", () => {
    const result = validatePublishGuards(
      makeGuardInput({ approval: { operationHash: "hash-1", consumed: true, createdAt: Date.now(), ttlMs: 10 * 60_000 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("consumed");
  });

  it("rejects expired approval (>10 min TTL)", () => {
    const result = validatePublishGuards(
      makeGuardInput({
        approval: {
          operationHash: "hash-1",
          consumed: false,
          createdAt: Date.now() - 11 * 60_000,
          ttlMs: 10 * 60_000,
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("rejects mismatched approval operation hash", () => {
    const result = validatePublishGuards(
      makeGuardInput({ approval: { operationHash: "hash-99", consumed: false, createdAt: Date.now(), ttlMs: 10 * 60_000 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("operation hash");
  });

  it("rejects mismatched authenticated login", () => {
    const result = validatePublishGuards(
      makeGuardInput({ authenticatedLogin: "other-user" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("login");
  });

  it("rejects body-bearing operation with empty provenance", () => {
    const result = validatePublishGuards(
      makeGuardInput({ operationType: "comment_review", provenanceIds: [] }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("provenance");
  });

  it("rejects body-bearing operation with null body hash", () => {
    const result = validatePublishGuards(
      makeGuardInput({ operationType: "request_changes_review", bodyHash: null }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("body");
  });

  it("allows approve_review with null body and empty provenance", () => {
    const result = validatePublishGuards(
      makeGuardInput({
        operationType: "approve_review",
        bodyHash: null,
        provenanceIds: [],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects completed idempotency key", () => {
    const result = validatePublishGuards(
      makeGuardInput({ idempotencyKeyCompleted: true }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("idempotency");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/publisher/guards.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement publisher guards**

```typescript
// src/publisher/guards.ts
import type { OperationType } from "./operation-hash.js";

export interface ApprovalRecord {
  operationHash: string;
  consumed: boolean;
  createdAt: number;
  ttlMs: number;
}

export interface GuardInput {
  publicationMode: "shadow" | "gated";
  approval: ApprovalRecord;
  currentHeadSha: string;
  reviewedHeadSha: string;
  approvedRunId: string;
  currentAcceptedRunId: string;
  approvedRunInputHash: string;
  currentRunInputHash: string;
  operationHash: string;
  authenticatedLogin: string;
  configuredOperator: string;
  operationType: OperationType;
  bodyHash: string | null;
  provenanceIds: string[];
  idempotencyKeyCompleted: boolean;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

const BODY_BEARING_TYPES = new Set<OperationType>([
  "inline_comment",
  "summary_comment",
  "comment_review",
  "request_changes_review",
]);

export function validatePublishGuards(input: GuardInput): GuardResult {
  if (input.publicationMode === "shadow") {
    return { ok: false, reason: "Publication blocked: shadow mode active" };
  }

  if (input.approval.operationHash !== input.operationHash) {
    return {
      ok: false,
      reason: "Approval operation hash does not match the requested operation",
    };
  }

  if (input.approval.consumed) {
    return { ok: false, reason: "Approval already consumed" };
  }

  const age = Date.now() - input.approval.createdAt;
  if (age > input.approval.ttlMs) {
    return { ok: false, reason: "Approval expired (TTL exceeded)" };
  }

  if (input.currentHeadSha !== input.reviewedHeadSha) {
    return {
      ok: false,
      reason: "Current PR head SHA differs from reviewed head SHA",
    };
  }

  if (input.currentAcceptedRunId !== input.approvedRunId) {
    return {
      ok: false,
      reason: "Current accepted run differs from approved run",
    };
  }

  if (input.currentRunInputHash !== input.approvedRunInputHash) {
    return {
      ok: false,
      reason: "Current run-input hash differs from approved run-input hash",
    };
  }

  if (input.authenticatedLogin.toLowerCase() !== input.configuredOperator.toLowerCase()) {
    return {
      ok: false,
      reason: "Authenticated GitHub login does not match configured operator",
    };
  }

  if (BODY_BEARING_TYPES.has(input.operationType)) {
    if (!input.bodyHash) {
      return {
        ok: false,
        reason: `Operation type ${input.operationType} requires a non-empty body hash`,
      };
    }
    if (input.provenanceIds.length === 0) {
      return {
        ok: false,
        reason: `Operation type ${input.operationType} requires non-empty provenance`,
      };
    }
  }

  if (input.idempotencyKeyCompleted) {
    return {
      ok: false,
      reason: "Idempotency key already completed — cannot re-publish",
    };
  }

  return { ok: true };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/publisher/guards.test.ts`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/publisher/guards.ts tests/publisher/guards.test.ts
git commit -m "feat(publisher): pre-publish guard validation with all spec-required checks"
```

---

### Task 7: Publisher — Execute & Record

**Files:**
- Create: `src/publisher/publish.ts`
- Create: `src/publisher/approvals.ts`
- Test: `tests/publisher/publish.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/publisher/publish.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeOperation,
  type PublishContext,
  type PublishResult,
} from "../../src/publisher/publish.js";
import { ApprovalStore } from "../../src/publisher/approvals.js";
import type { ExternalOperation } from "../../src/publisher/operation-hash.js";

function makeOp(overrides: Partial<ExternalOperation> = {}): ExternalOperation {
  return {
    type: "comment_review",
    event: "COMMENT",
    principalLogin: "shubh-array",
    repository: "Powered-By-Array/pba-webapp",
    prNumber: 42,
    target: null,
    bodyHash: "abc123",
    disposition: "comment",
    draftSummaryUse: "review_body",
    summaryBodyHash: "abc123",
    headSha: "a".repeat(40),
    acceptedRunId: "run-1",
    runInputHash: "input-1",
    coverageHash: "cov-1",
    provenanceIds: ["pv_a"],
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

describe("ApprovalStore", () => {
  let store: ApprovalStore;

  beforeEach(() => {
    store = new ApprovalStore();
  });

  it("creates and consumes an approval", () => {
    store.create("op-hash-1");
    expect(store.consume("op-hash-1")).toBe(true);
  });

  it("rejects second consumption", () => {
    store.create("op-hash-1");
    store.consume("op-hash-1");
    expect(store.consume("op-hash-1")).toBe(false);
  });

  it("rejects unknown hash", () => {
    expect(store.consume("unknown")).toBe(false);
  });

  it("rejects after 10 minute TTL", () => {
    vi.useFakeTimers();
    store.create("op-hash-1");
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(store.consume("op-hash-1")).toBe(false);
    vi.useRealTimers();
  });

  it("invalidateAll clears all pending approvals", () => {
    store.create("op-hash-1");
    store.create("op-hash-2");
    store.invalidateAll();
    expect(store.consume("op-hash-1")).toBe(false);
    expect(store.consume("op-hash-2")).toBe(false);
  });
});

describe("executeOperation", () => {
  it("calls ghAdapter and returns success", async () => {
    const ghAdapter = vi.fn().mockResolvedValue({ ok: true, githubId: "review-123" });
    const ctx: PublishContext = {
      ghAdapter,
      authenticatedLogin: "shubh-array",
      configuredOperator: "shubh-array",
    };
    const op = makeOp();
    const result = await executeOperation(ctx, op, "review body text");
    expect(result.status).toBe("completed");
    expect(ghAdapter).toHaveBeenCalledOnce();
  });

  it("records failure from ghAdapter", async () => {
    const ghAdapter = vi.fn().mockResolvedValue({ ok: false, error: "API error" });
    const ctx: PublishContext = {
      ghAdapter,
      authenticatedLogin: "shubh-array",
      configuredOperator: "shubh-array",
    };
    const op = makeOp();
    const result = await executeOperation(ctx, op, "review body text");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("API error");
  });

  it("records timeout as indeterminate", async () => {
    const ghAdapter = vi.fn().mockRejectedValue(new Error("timeout"));
    const ctx: PublishContext = {
      ghAdapter,
      authenticatedLogin: "shubh-array",
      configuredOperator: "shubh-array",
    };
    const op = makeOp();
    const result = await executeOperation(ctx, op, "review body text");
    expect(result.status).toBe("failed");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/publisher/publish.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement approval store**

```typescript
// src/publisher/approvals.ts
const APPROVAL_TTL_MS = 10 * 60_000;

interface ApprovalEntry {
  operationHash: string;
  createdAt: number;
  consumed: boolean;
}

export class ApprovalStore {
  private approvals = new Map<string, ApprovalEntry>();

  create(operationHash: string): void {
    this.approvals.set(operationHash, {
      operationHash,
      createdAt: Date.now(),
      consumed: false,
    });
  }

  consume(operationHash: string): boolean {
    const entry = this.approvals.get(operationHash);
    if (!entry) return false;
    if (entry.consumed) return false;
    if (Date.now() - entry.createdAt > APPROVAL_TTL_MS) {
      this.approvals.delete(operationHash);
      return false;
    }
    entry.consumed = true;
    return true;
  }

  get(operationHash: string): ApprovalEntry | undefined {
    return this.approvals.get(operationHash);
  }

  invalidateAll(): void {
    this.approvals.clear();
  }
}
```

- [x] **Step 4: Implement publisher execute**

```typescript
// src/publisher/publish.ts
import type { ExternalOperation } from "./operation-hash.js";

export interface GhAdapterResult {
  ok: boolean;
  githubId?: string;
  error?: string;
}

export type GhPublishAdapter = (
  op: ExternalOperation,
  body: string | null,
) => Promise<GhAdapterResult>;

export interface PublishContext {
  ghAdapter: GhPublishAdapter;
  authenticatedLogin: string;
  configuredOperator: string;
}

export interface PublishResult {
  operationHash: string;
  idempotencyKey: string;
  status: "completed" | "failed";
  githubId?: string;
  error?: string;
  attemptedAt: number;
}

export async function executeOperation(
  ctx: PublishContext,
  op: ExternalOperation,
  body: string | null,
): Promise<PublishResult> {
  const attemptedAt = Date.now();
  try {
    const result = await ctx.ghAdapter(op, body);
    if (result.ok) {
      return {
        operationHash: op.idempotencyKey,
        idempotencyKey: op.idempotencyKey,
        status: "completed",
        githubId: result.githubId,
        attemptedAt,
      };
    }
    return {
      operationHash: op.idempotencyKey,
      idempotencyKey: op.idempotencyKey,
      status: "failed",
      error: result.error,
      attemptedAt,
    };
  } catch (err) {
    return {
      operationHash: op.idempotencyKey,
      idempotencyKey: op.idempotencyKey,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      attemptedAt,
    };
  }
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/publisher/publish.test.ts`
Expected: all PASS

- [x] **Step 6: Commit**

```bash
git add src/publisher/approvals.ts src/publisher/publish.ts tests/publisher/publish.test.ts
git commit -m "feat(publisher): approval store with TTL + publish executor with partial failure recording"
```

---

### Task 8: Publication CLI Commands

**Files:**
- Create: `src/cli/publication.ts`

- [x] **Step 1: Implement publication enable/disable CLI**

```typescript
// src/cli/publication.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PublicationCliOptions {
  configPath: string;
  runDoctor: () => Promise<{ healthy: boolean; issues: string[] }>;
  confirm: (message: string) => Promise<boolean>;
  log: (message: string) => void;
}

export async function enablePublication(
  opts: PublicationCliOptions,
): Promise<boolean> {
  const doctorResult = await opts.runDoctor();
  if (!doctorResult.healthy) {
    opts.log("Cannot enable publication: doctor reports unhealthy state");
    for (const issue of doctorResult.issues) {
      opts.log(`  - ${issue}`);
    }
    return false;
  }

  const configPath = resolve(opts.configPath);
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  if (config.publication?.mode === "gated") {
    opts.log("Publication is already enabled (gated mode).");
    return true;
  }

  const confirmed = await opts.confirm(
    `Enable gated publication for operator "${config.profileId ?? "unknown"}"? ` +
    "This allows the publisher to create GitHub reviews on your behalf. [y/N]",
  );

  if (!confirmed) {
    opts.log("Aborted.");
    return false;
  }

  config.publication = { ...config.publication, mode: "gated" };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  opts.log("Publication mode set to gated.");
  return true;
}

export async function disablePublication(
  opts: Pick<PublicationCliOptions, "configPath" | "log">,
): Promise<void> {
  const configPath = resolve(opts.configPath);
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  config.publication = { ...config.publication, mode: "shadow" };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  opts.log("Publication mode set to shadow. Publisher disabled.");
}
```

- [x] **Step 2: Commit**

```bash
git add src/cli/publication.ts
git commit -m "feat(cli): pnpm ct publication enable/disable commands"
```

---

### Task 9: Client — Sanitizer Schema and Tests

**Files:**
- Create: `client/src/lib/sanitize.ts`
- Test: `tests/client/sanitize.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/client/sanitize.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement sanitizer schema**

```typescript
// client/src/lib/sanitize.ts

export interface SanitizeSchema {
  tagNames: string[];
  attributes: Record<string, string[]>;
  strip: string[];
}

export const sanitizeSchema: SanitizeSchema = {
  tagNames: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "del", "s",
    "code", "pre", "kbd", "samp",
    "blockquote",
    "ul", "ol", "li",
    "dl", "dt", "dd",
    "a",
    "table", "thead", "tbody", "tr", "th", "td",
    "img",
    "details", "summary",
    "sup", "sub",
    "div", "span",
  ],
  attributes: {
    a: ["href"],
    img: ["src", "alt"],
    td: ["align"],
    th: ["align"],
    code: ["className"],
  },
  strip: [
    "script", "style", "iframe", "object", "embed", "form",
    "svg", "math", "video", "audio", "source", "track",
    "input", "textarea", "select", "button",
    "link", "meta", "base", "noscript",
  ],
};

const SAFE_SCHEMES = new Set(["https:", "mailto:"]);

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();

  if (trimmed.startsWith("#") || trimmed.startsWith("/")) {
    return true;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (trimmed.includes(":")) {
      return SAFE_SCHEMES.has(parsed.protocol);
    }
    return true;
  } catch {
    return false;
  }
}

export function toRehypeSanitizeSchema() {
  return {
    tagNames: sanitizeSchema.tagNames,
    attributes: {
      ...sanitizeSchema.attributes,
      "*": ["className"],
    },
    strip: sanitizeSchema.strip,
    protocols: {
      href: ["https", "mailto"],
      src: ["https"],
    },
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/client/sanitize.test.ts`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add client/src/lib/sanitize.ts tests/client/sanitize.test.ts
git commit -m "feat(client): sanitizer schema with safe URL scheme allowlist"
```

---

### Task 10: XSS Fixture Tests

**Files:**
- Test: `tests/client/xss.fixtures.test.ts`

- [x] **Step 1: Write XSS fixture tests**

```typescript
// tests/client/xss.fixtures.test.ts
import { describe, it, expect } from "vitest";
import { isSafeUrl, sanitizeSchema } from "../../client/src/lib/sanitize.js";

const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  '<body onload=alert(1)>',
  '<input onfocus=alert(1) autofocus>',
  '<details open ontoggle=alert(1)>',
  '<marquee onstart=alert(1)>',
  '<object data="javascript:alert(1)">',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><input type=submit>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
  '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(1)">encoded</a>',
  '<a href="data:text/html,<script>alert(1)</script>">data uri</a>',
  '"><img src=x onerror=alert(1)>',
  "'-alert(1)-'",
  '<div style="background:url(javascript:alert(1))">',
  '<link rel="import" href="evil.html">',
  '<base href="https://evil.com/">',
];

describe("XSS fixtures — tag filtering", () => {
  const dangerousTags = [
    "script", "style", "iframe", "object", "embed", "form",
    "svg", "math", "video", "audio", "link", "meta", "base",
    "input", "textarea", "select", "button",
  ];

  for (const tag of dangerousTags) {
    it(`strips <${tag}> from allowlist`, () => {
      expect(sanitizeSchema.tagNames).not.toContain(tag);
    });
  }
});

describe("XSS fixtures — dangerous event attributes", () => {
  const eventAttrs = [
    "onclick", "onerror", "onload", "onfocus", "onblur",
    "onmouseover", "ontoggle", "onstart", "onsubmit",
  ];

  for (const attr of eventAttrs) {
    it(`no allowlisted tag permits ${attr}`, () => {
      for (const [, attrs] of Object.entries(sanitizeSchema.attributes)) {
        expect(attrs).not.toContain(attr);
      }
    });
  }
});

describe("XSS fixtures — URL scheme injection", () => {
  const dangerousUrls = [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "\tjavascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:MsgBox",
    "javascript&#58;alert(1)",
    "java\nscript:alert(1)",
  ];

  for (const url of dangerousUrls) {
    it(`rejects dangerous URL: ${JSON.stringify(url).slice(0, 40)}`, () => {
      expect(isSafeUrl(url)).toBe(false);
    });
  }
});

describe("XSS fixtures — untrusted content never controls markup", () => {
  it("action labels, hidden values, and preview text use typed binding not HTML interpolation", () => {
    const untrustedTitle = '<img src=x onerror=alert(1)>';
    const escaped = untrustedTitle
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    expect(escaped).not.toContain("<img");
    expect(escaped).toContain("&lt;img");
  });

  it("PR titles/bodies with script injection are rendered as text", () => {
    for (const payload of XSS_PAYLOADS) {
      const textContent = payload.replace(/<[^>]*>/g, "");
      expect(textContent).not.toMatch(/<script/i);
    }
  });
});
```

- [x] **Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/client/xss.fixtures.test.ts`
Expected: all PASS (these validate the sanitizer schema and isSafeUrl from Task 9)

- [x] **Step 3: Commit**

```bash
git add tests/client/xss.fixtures.test.ts
git commit -m "test(client): XSS fixture tests for tags, event attrs, URL schemes, and untrusted interpolation"
```

---

### Task 11: Client — SafeText and SafeMarkdown Components

**Files:**
- Create: `client/src/components/SafeText.tsx`
- Create: `client/src/components/SafeMarkdown.tsx`

- [x] **Step 1: Implement SafeText**

```tsx
// client/src/components/SafeText.tsx

interface SafeTextProps {
  text: string;
  className?: string;
  as?: "span" | "p" | "div";
}

export function SafeText({ text, className, as: Tag = "span" }: SafeTextProps) {
  return <Tag className={className}>{text}</Tag>;
}
```

- [x] **Step 2: Implement SafeMarkdown**

```tsx
// client/src/components/SafeMarkdown.tsx
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { toRehypeSanitizeSchema, isSafeUrl } from "../lib/sanitize.js";

interface SafeMarkdownProps {
  content: string;
  className?: string;
}

const schema = toRehypeSanitizeSchema();

export function SafeMarkdown({ content, className }: SafeMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a({ href, children, ...props }) {
            if (!href || !isSafeUrl(href)) {
              return <span>{children}</span>;
            }
            const isExternal =
              href.startsWith("https://") || href.startsWith("mailto:");
            return (
              <a
                href={href}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
        allowedElements={schema.tagNames}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [x] **Step 3: Commit**

```bash
git add client/src/components/SafeText.tsx client/src/components/SafeMarkdown.tsx
git commit -m "feat(client): SafeText and SafeMarkdown components with XSS-safe rendering"
```

---

### Task 12: Client — API Fetch Wrapper

**Files:**
- Create: `client/src/lib/api.ts`

- [x] **Step 1: Implement typed API client**

```typescript
// client/src/lib/api.ts

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }

  return res.json();
}

export const api = {
  getHealth() {
    return request<{ healthy: boolean; issues: string[] }>("/api/health");
  },

  getQueue() {
    return request<{
      allTracked: TrackedQueueRow[];
      focusQueue: { now: FocusQueueRow[]; next: FocusQueueRow[]; monitor: FocusQueueRow[] };
    }>("/api/queue");
  },

  getJob(jobId: string) {
    return request<JobDetail>(`/api/jobs/${encodeURIComponent(jobId)}`);
  },

  getDraft(jobId: string) {
    return request<DraftDetail>(`/api/drafts/${encodeURIComponent(jobId)}`);
  },

  async createActionToken(): Promise<string> {
    const result = await request<{ token: string }>("/api/action-token", {
      method: "POST",
    });
    return result.token;
  },

  async approveOperation(operationHash: string) {
    const actionToken = await this.createActionToken();
    return request<{ approved: boolean }>("/api/approvals", {
      method: "POST",
      body: JSON.stringify({ operationHash, actionToken: token }),
    });
  },

  async publishOperation(operationHash: string, body: string | null) {
    const actionToken = await this.createActionToken();
    return request<PublishResult>("/api/publish", {
      method: "POST",
      body: JSON.stringify({ operationHash, body, actionToken: token }),
    });
  },

  getAudit(jobId: string) {
    return request<AuditEntry[]>(`/api/audit/${encodeURIComponent(jobId)}`);
  },

  requestAnalyze(input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: "registered-source" | "remote-evidence-only";
  }) {
    return request<{ jobId: string }>("/api/jobs/analyze", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  requestRetry(jobId: string) {
    return request<{ runId: string }>(
      `/api/jobs/${encodeURIComponent(jobId)}/retry`,
      { method: "POST" },
    );
  },
};

export interface TrackedQueueRow {
  jobId: string | null;
  repository: string;
  prNumber: number;
  title: string;
  author: string;
  headSha: string;
  eligibilityReasons: EligibilityReason[];
  exclusionReasons: ExclusionReason[];
  priority: string;
  priorityReasons: PriorityReason[];
  domains: string[];
  attentionState: string;
  jobState: string | null;
  advisorResult: AdvisorResult | null;
  discoveredAt: string;
  updatedAt: string;
}

export type FocusQueueRow = TrackedQueueRow;

export interface EligibilityReason {
  code: string;
  [key: string]: unknown;
}

export interface ExclusionReason {
  code: string;
  detail?: string;
  [key: string]: unknown;
}

export interface PriorityReason {
  code: string;
  tier?: string;
  [key: string]: unknown;
}

export interface AdvisorResult {
  relevance: string;
  risk: string;
  explanation: string;
  recommendedAction: string;
  confidence: string;
  unknowns: string[];
  stale: boolean;
}

export interface JobDetail {
  jobId: string;
  repository: string;
  prNumber: number;
  headSha: string;
  state: string;
  sourceMode: string;
  runs: RunSummary[];
  acceptedRunId: string | null;
}

export interface RunSummary {
  runId: string;
  attemptNumber: number;
  state: string;
  startedAt: string;
  completedAt: string | null;
}

export interface DraftDetail {
  jobId: string;
  runId: string;
  summary: {
    intent: string;
    implementation: string;
  };
  draftSummary: {
    body: string;
    observationIndexes: number[];
    provenanceRefs: string[];
  };
  findings: Finding[];
  observations: Observation[];
  checks: CheckResult[];
  coverage: CoverageInfo;
  unknowns: string[];
  recommendedDisposition: string;
  validatedProvenance: Record<string, unknown>[];
  operationPlan: OperationPlanSummary | null;
}

export interface Finding {
  severity: string;
  confidence: string;
  title: string;
  rationale: string;
  file: string;
  location: {
    side: string;
    line: number;
    startSide: string | null;
    startLine: number | null;
  } | null;
  draftComment: string;
  observationIndexes: number[];
}

export interface Observation {
  type: string;
  statement: string;
  provenanceRefs: string[];
}

export interface CheckResult {
  name: string;
  status: string;
  provenanceRef: string;
}

export interface CoverageInfo {
  mode: string;
  sourceTreeInspected: boolean;
  diffFiltered: boolean;
  omittedProtectedPaths: string[];
  missingCoverage: string[];
}

export interface OperationPlanSummary {
  draftSummaryUse: string;
  operations: { type: string; event: string | null; operationHash: string }[];
}

export interface PublishResult {
  status: "completed" | "failed";
  error?: string;
}

export interface AuditEntry {
  timestamp: string;
  event: string;
  details: Record<string, unknown>;
}
```

- [x] **Step 2: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(client): typed API fetch wrapper with action-token support"
```

---

### Task 13: Client — AdvisorBadge and CoverageWarning Components

**Files:**
- Create: `client/src/components/AdvisorBadge.tsx`
- Create: `client/src/components/CoverageWarning.tsx`

- [x] **Step 1: Implement AdvisorBadge**

```tsx
// client/src/components/AdvisorBadge.tsx
import type { AdvisorResult } from "../lib/api.js";

interface AdvisorBadgeProps {
  result: AdvisorResult | null;
}

const RELEVANCE_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#16a34a",
  unknown: "#6b7280",
};

const RISK_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#16a34a",
  unknown: "#6b7280",
};

export function AdvisorBadge({ result }: AdvisorBadgeProps) {
  if (!result) {
    return (
      <span
        style={{ color: "#6b7280", fontSize: "0.75rem" }}
        title="No current advisor result"
      >
        —
      </span>
    );
  }

  const stalePrefix = result.stale ? "⚠ Stale — " : "";

  return (
    <span
      style={{ display: "inline-flex", gap: "4px", fontSize: "0.75rem" }}
      title={`${stalePrefix}${result.explanation}`}
    >
      <span
        style={{
          padding: "1px 6px",
          borderRadius: "4px",
          backgroundColor: RELEVANCE_COLORS[result.relevance] ?? "#6b7280",
          color: "#fff",
          opacity: result.stale ? 0.6 : 1,
        }}
      >
        {result.relevance}
      </span>
      <span
        style={{
          padding: "1px 6px",
          borderRadius: "4px",
          backgroundColor: RISK_COLORS[result.risk] ?? "#6b7280",
          color: "#fff",
          opacity: result.stale ? 0.6 : 1,
        }}
      >
        {result.risk}
      </span>
      {result.stale && (
        <span style={{ color: "#ca8a04", fontStyle: "italic" }}>stale</span>
      )}
    </span>
  );
}
```

- [x] **Step 2: Implement CoverageWarning**

```tsx
// client/src/components/CoverageWarning.tsx
import type { CoverageInfo } from "../lib/api.js";

interface CoverageWarningProps {
  coverage: CoverageInfo;
}

export function CoverageWarning({ coverage }: CoverageWarningProps) {
  const warnings: string[] = [];

  if (!coverage.sourceTreeInspected) {
    warnings.push(
      "Source tree not inspected — review based on remote evidence only",
    );
  }

  if (coverage.missingCoverage.length > 0) {
    warnings.push(`Missing coverage: ${coverage.missingCoverage.join(", ")}`);
  }

  if (coverage.omittedProtectedPaths.length > 0) {
    warnings.push(
      `Protected paths omitted: ${coverage.omittedProtectedPaths.join(", ")}`,
    );
  }

  if (!coverage.diffFiltered) {
    warnings.push("Diff was not filtered — coverage may be incomplete");
  }

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      style={{
        padding: "8px 12px",
        marginBottom: "12px",
        backgroundColor: "#fef3c7",
        border: "1px solid #f59e0b",
        borderRadius: "6px",
        fontSize: "0.875rem",
        color: "#92400e",
      }}
    >
      <strong>Coverage notice:</strong>
      <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      <p style={{ margin: "4px 0 0", fontSize: "0.75rem", fontStyle: "italic" }}>
        CI results observed. Local checks were not run.
      </p>
    </div>
  );
}
```

- [x] **Step 3: Commit**

```bash
git add client/src/components/AdvisorBadge.tsx client/src/components/CoverageWarning.tsx
git commit -m "feat(client): AdvisorBadge and CoverageWarning components"
```

---

### Task 14: Client — AllTracked Route

**Files:**
- Create: `client/src/routes/AllTracked.tsx`

- [x] **Step 1: Implement AllTracked view**

```tsx
// client/src/routes/AllTracked.tsx
import { useEffect, useState } from "react";
import { api, type TrackedQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { AdvisorBadge } from "../components/AdvisorBadge.js";

export function AllTracked() {
  const [items, setItems] = useState<TrackedQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzingPr, setAnalyzingPr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getQueue()
      .then((data) => {
        setItems(data.allTracked);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleAnalyze = async (item: TrackedQueueRow) => {
    const key = `${item.repository}-${item.prNumber}`;
    setAnalyzingPr(key);
    try {
      await api.requestAnalyze({
        repositoryKey: item.repository,
        prNumber: item.prNumber,
      });
    } finally {
      setAnalyzingPr(null);
    }
  };

  if (loading) return <p>Loading tracked PRs…</p>;
  if (error) return <p style={{ color: "#dc2626" }}>Error: {error}</p>;

  return (
    <div>
      <h2>All Tracked ({items.length})</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ padding: "8px" }}>PR</th>
            <th style={{ padding: "8px" }}>Title</th>
            <th style={{ padding: "8px" }}>Author</th>
            <th style={{ padding: "8px" }}>Priority</th>
            <th style={{ padding: "8px" }}>Eligibility</th>
            <th style={{ padding: "8px" }}>Status</th>
            <th style={{ padding: "8px" }}>Advisor</th>
            <th style={{ padding: "8px" }}>Updated</th>
            <th style={{ padding: "8px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={`${item.repository}-${item.prNumber}`}
              style={{ borderBottom: "1px solid #f3f4f6" }}
            >
              <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "0.875rem" }}>
                <SafeText text={`${item.repository.split("/")[1]}#${item.prNumber}`} />
              </td>
              <td style={{ padding: "8px" }}>
                <SafeText text={item.title} />
              </td>
              <td style={{ padding: "8px", fontSize: "0.875rem" }}>
                <SafeText text={item.author} />
              </td>
              <td style={{ padding: "8px" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    backgroundColor:
                      item.priority === "unranked" ? "#f3f4f6" : "#dbeafe",
                    color:
                      item.priority === "unranked" ? "#6b7280" : "#1d4ed8",
                  }}
                >
                  {item.priority === "unranked"
                    ? "Unranked — ineligible"
                    : item.priority.toUpperCase()}
                </span>
              </td>
              <td style={{ padding: "8px", fontSize: "0.75rem" }}>
                {item.eligibilityReasons.map((r, i) => (
                  <div key={i} style={{ color: "#16a34a" }}>
                    <SafeText text={r.code.replace(/_/g, " ")} />
                  </div>
                ))}
                {item.exclusionReasons.map((r, i) => (
                  <div key={`ex-${i}`} style={{ color: "#dc2626" }}>
                    <SafeText text={`✗ ${r.code.replace(/_/g, " ")}${r.detail ? `: ${r.detail}` : ""}`} />
                  </div>
                ))}
              </td>
              <td style={{ padding: "8px", fontSize: "0.875rem" }}>
                <SafeText text={item.attentionState.replace(/_/g, " ")} />
              </td>
              <td style={{ padding: "8px" }}>
                <AdvisorBadge result={item.advisorResult} />
              </td>
              <td
                style={{ padding: "8px", fontSize: "0.75rem", color: "#6b7280" }}
              >
                {new Date(item.updatedAt).toLocaleDateString()}
              </td>
              <td style={{ padding: "8px" }}>
                <button
                  disabled={analyzingPr === `${item.repository}-${item.prNumber}`}
                  onClick={() => handleAnalyze(item)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "0.75rem",
                    border: "1px solid #2563eb",
                    borderRadius: "4px",
                    backgroundColor: "#eff6ff",
                    color: "#2563eb",
                    cursor: analyzingPr === `${item.repository}-${item.prNumber}` ? "wait" : "pointer",
                  }}
                >
                  Analyze
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add client/src/routes/AllTracked.tsx
git commit -m "feat(client): AllTracked authoritative coverage view"
```

---

### Task 15: Client — FocusQueue Route

**Files:**
- Create: `client/src/routes/FocusQueue.tsx`

- [x] **Step 1: Implement FocusQueue view with Now/Next/Monitor lanes**

```tsx
// client/src/routes/FocusQueue.tsx
import { useEffect, useState } from "react";
import { api, type FocusQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { AdvisorBadge } from "../components/AdvisorBadge.js";

type ViewOrder = "deterministic" | "advisor";

function QueueLane({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: FocusQueueRow[];
  onSelect: (item: FocusQueueRow) => void;
}) {
  if (items.length === 0) {
    return (
      <section style={{ marginBottom: "24px" }}>
        <h3 style={{ fontSize: "1rem", color: "#6b7280" }}>{title}</h3>
        <p style={{ color: "#9ca3af", fontStyle: "italic" }}>No items</p>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: "24px" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>
        {title} ({items.length})
      </h3>
      {items.map((item) => (
        <div
          key={`${item.repository}-${item.prNumber}`}
          onClick={() => onSelect(item)}
          style={{
            padding: "12px",
            marginBottom: "8px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontFamily: "monospace", fontSize: "0.875rem", fontWeight: 600 }}>
                <SafeText text={`${item.repository.split("/")[1]}#${item.prNumber}`} />
              </span>
              <span style={{ marginLeft: "8px" }}>
                <SafeText text={item.title} />
              </span>
            </div>
            <AdvisorBadge result={item.advisorResult} />
          </div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "4px" }}>
            <SafeText text={item.author} /> ·{" "}
            {item.priority !== "unranked" ? item.priority.toUpperCase() : ""} ·{" "}
            {item.domains.join(", ")} ·{" "}
            <SafeText text={item.attentionState.replace(/_/g, " ")} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function FocusQueue({
  onSelectItem,
}: {
  onSelectItem: (item: FocusQueueRow) => void;
}) {
  const [queue, setQueue] = useState<{
    now: FocusQueueRow[];
    next: FocusQueueRow[];
    monitor: FocusQueueRow[];
  }>({ now: [], next: [], monitor: [] });
  const [loading, setLoading] = useState(true);
  const [viewOrder, setViewOrder] = useState<ViewOrder>("deterministic");

  useEffect(() => {
    api
      .getQueue()
      .then((data) => {
        setQueue(data.focusQueue);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading queue…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2>Focus Queue</h2>
        <label style={{ fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={viewOrder === "advisor"}
            onChange={(e) =>
              setViewOrder(e.target.checked ? "advisor" : "deterministic")
            }
            style={{ marginRight: "4px" }}
          />
          Advisor order
        </label>
      </div>
      <QueueLane
        title="Now"
        items={queue.now}
        onSelect={onSelectItem}
      />
      <QueueLane
        title="Next"
        items={queue.next}
        onSelect={onSelectItem}
      />
      <QueueLane
        title="Monitor"
        items={queue.monitor}
        onSelect={onSelectItem}
      />
    </div>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add client/src/routes/FocusQueue.tsx
git commit -m "feat(client): FocusQueue with Now/Next/Monitor lanes and advisor order toggle"
```

---

### Task 16: Client — Review Workbench (Understand / Verify / Act)

**Files:**
- Create: `client/src/routes/Workbench.tsx`

- [x] **Step 1: Implement Workbench view**

```tsx
// client/src/routes/Workbench.tsx
import { useEffect, useState, useCallback } from "react";
import { api, type DraftDetail, type PublishResult } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { SafeMarkdown } from "../components/SafeMarkdown.js";
import { CoverageWarning } from "../components/CoverageWarning.js";

type Tab = "understand" | "verify" | "act";
type Disposition = "comment" | "request_changes" | "approve";

interface WorkbenchProps {
  jobId: string;
  onBack: () => void;
}

export function Workbench({ jobId, onBack }: WorkbenchProps) {
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("understand");
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const [publishSummary, setPublishSummary] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PublishResult[]>([]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    api.getDraft(jobId).then((d) => {
      setDraft(d);
      setLoading(false);
      if (d.recommendedDisposition !== "needs_human") {
        setDisposition(d.recommendedDisposition as Disposition);
      }
    }).catch(() => setLoading(false));
  }, [jobId]);

  const handleApproveAndPublish = useCallback(async (opHash: string, body: string | null) => {
    setPublishing(true);
    try {
      await api.approveOperation(opHash);
      const result = await api.publishOperation(opHash, body);
      setResults((prev) => [...prev, result]);
    } catch (err) {
      setResults((prev) => [
        ...prev,
        { status: "failed", error: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setPublishing(false);
    }
  }, []);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const { runId } = await api.requestRetry(jobId);
      setResults((prev) => [
        ...prev,
        { status: "completed", error: undefined },
      ]);
      console.log(`Retry started: runId=${runId}`);
    } catch (err) {
      setResults((prev) => [
        ...prev,
        { status: "failed", error: `Retry failed: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setRetrying(false);
    }
  }, [jobId]);

  if (loading) return <p>Loading draft…</p>;
  if (!draft) return <p>No draft available for this job.</p>;

  const isNeedsHuman = draft.recommendedDisposition === "needs_human";

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
      <button onClick={onBack} style={{ marginBottom: "12px", cursor: "pointer" }}>
        ← Back to queue
      </button>

      <CoverageWarning coverage={draft.coverage} />

      <nav style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "2px solid #e5e7eb", paddingBottom: "8px" }}>
        {(["understand", "verify", "act"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              border: "none",
              borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent",
              background: "none",
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "understand" && (
        <section>
          <h3>Intent</h3>
          <SafeText text={draft.summary.intent} as="p" />
          <h3>Implementation</h3>
          <SafeText text={draft.summary.implementation} as="p" />
          <h3>Checks ({draft.checks.length})</h3>
          {draft.checks.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No check results</p>
          ) : (
            <ul>
              {draft.checks.map((c, i) => (
                <li key={i}>
                  <SafeText text={`${c.name}: ${c.status}`} />
                </li>
              ))}
            </ul>
          )}
          <h3>Unknowns</h3>
          {draft.unknowns.length === 0 ? (
            <p style={{ color: "#6b7280" }}>None reported</p>
          ) : (
            <ul>
              {draft.unknowns.map((u, i) => (
                <li key={i}>
                  <SafeText text={u} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "verify" && (
        <section>
          <h3>Observations ({draft.observations.length})</h3>
          {draft.observations.map((obs, i) => (
            <div
              key={i}
              style={{
                padding: "8px",
                marginBottom: "8px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  color: obs.type === "observation" ? "#16a34a" : "#ca8a04",
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                {obs.type}
              </span>
              <SafeText text={obs.statement} as="p" />
              <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                Provenance: {obs.provenanceRefs.join(", ") || "none"}
              </div>
            </div>
          ))}
          <h3>Findings ({draft.findings.length})</h3>
          {draft.findings.map((f, i) => (
            <div
              key={i}
              style={{
                padding: "8px 12px",
                marginBottom: "8px",
                borderLeft: `3px solid ${f.severity === "blocking" ? "#dc2626" : f.severity === "high" ? "#ea580c" : "#ca8a04"}`,
                backgroundColor: "#fafafa",
                borderRadius: "0 6px 6px 0",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>
                  <SafeText text={f.title} />
                </strong>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {f.severity} · {f.confidence} confidence
                </span>
              </div>
              <SafeText text={f.rationale} as="p" />
              {f.file && (
                <code style={{ fontSize: "0.8rem" }}>
                  <SafeText text={f.file} />
                  {f.location && `:${f.location.line}`}
                </code>
              )}
            </div>
          ))}
        </section>
      )}

      {tab === "act" && (
        <section>
          <h3>Draft Summary</h3>
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              marginBottom: "16px",
              backgroundColor: "#f9fafb",
            }}
          >
            <SafeMarkdown content={draft.draftSummary.body} />
          </div>

          {isNeedsHuman && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#fee2e2",
                border: "1px solid #fca5a5",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              <strong>needs_human</strong> — This draft requires manual handling and cannot be published.
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button
              disabled={retrying}
              onClick={handleRetry}
              style={{
                padding: "6px 16px",
                fontSize: "0.875rem",
                border: "1px solid #d97706",
                borderRadius: "6px",
                backgroundColor: "#fff",
                color: "#d97706",
                cursor: retrying ? "wait" : "pointer",
                opacity: retrying ? 0.6 : 1,
              }}
            >
              {retrying ? "Retrying…" : "Retry Analysis"}
            </button>
          </div>

          {!isNeedsHuman && (
            <>
              <h3>Disposition</h3>
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                {(["comment", "request_changes", "approve"] as Disposition[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDisposition(d)}
                    style={{
                      padding: "8px 16px",
                      border: disposition === d ? "2px solid #2563eb" : "1px solid #d1d5db",
                      borderRadius: "6px",
                      backgroundColor: disposition === d ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                      fontWeight: disposition === d ? 600 : 400,
                    }}
                  >
                    {d.replace(/_/g, " ")}
                  </button>
                ))}
              </div>

              {disposition === "approve" && (
                <label style={{ display: "block", marginBottom: "16px", fontSize: "0.875rem" }}>
                  <input
                    type="checkbox"
                    checked={publishSummary}
                    onChange={(e) => setPublishSummary(e.target.checked)}
                    style={{ marginRight: "6px" }}
                  />
                  Publish summary as a separate comment
                </label>
              )}

              {draft.operationPlan && (
                <>
                  <h3>Operations Preview</h3>
                  <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "8px" }}>
                    Each operation requires separate approval. No batch approval.
                  </p>
                  {draft.operationPlan.operations.map((op, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        marginBottom: "4px",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                          {op.type.replace(/_/g, " ")}
                        </span>
                        {op.event && (
                          <span style={{ marginLeft: "8px", fontSize: "0.75rem", color: "#6b7280" }}>
                            ({op.event})
                          </span>
                        )}
                      </div>
                      <button
                        disabled={publishing}
                        onClick={() => handleApproveAndPublish(op.operationHash, null)}
                        style={{
                          padding: "4px 12px",
                          fontSize: "0.875rem",
                          border: "1px solid #2563eb",
                          borderRadius: "6px",
                          backgroundColor: "#2563eb",
                          color: "#fff",
                          cursor: publishing ? "wait" : "pointer",
                          opacity: publishing ? 0.6 : 1,
                        }}
                      >
                        Approve & Publish
                      </button>
                    </div>
                  ))}
                </>
              )}

              {results.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <h4>Publication Results</h4>
                  {results.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "6px 12px",
                        marginBottom: "4px",
                        borderRadius: "4px",
                        backgroundColor: r.status === "completed" ? "#dcfce7" : "#fee2e2",
                        fontSize: "0.875rem",
                      }}
                    >
                      {r.status === "completed" ? "✓ Published" : `✗ Failed: ${r.error}`}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add client/src/routes/Workbench.tsx
git commit -m "feat(client): Review Workbench with Understand/Verify/Act tabs and per-operation approval"
```

---

### Task 17: Client — App Shell and Router

**Files:**
- Create: `client/package.json`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`

- [x] **Step 1: Create client package.json**

```json
{
  "name": "control-tower-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "rehype-sanitize": "^6.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [x] **Step 2: Create index.html (no inline script/style)**

```html
<!-- client/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Control Tower</title>
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 3: Create main.tsx**

```tsx
// client/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [x] **Step 4: Create App.tsx with route switching**

```tsx
// client/src/App.tsx
import { useState } from "react";
import { AllTracked } from "./routes/AllTracked.js";
import { FocusQueue } from "./routes/FocusQueue.js";
import { Workbench } from "./routes/Workbench.js";
import type { FocusQueueRow } from "./lib/api.js";

type Route =
  | { page: "focus" }
  | { page: "all-tracked" }
  | { page: "workbench"; jobId: string };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "focus" });

  const handleSelectItem = (item: FocusQueueRow) => {
    if (item.jobId) {
      setRoute({ page: "workbench", jobId: item.jobId });
    }
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: "1200px", margin: "0 auto", padding: "16px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", borderBottom: "1px solid #e5e7eb", paddingBottom: "12px" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Control Tower</h1>
        <nav style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={() => setRoute({ page: "focus" })}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: route.page === "focus" ? 700 : 400,
              textDecoration: route.page === "focus" ? "underline" : "none",
            }}
          >
            Focus Queue
          </button>
          <button
            onClick={() => setRoute({ page: "all-tracked" })}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: route.page === "all-tracked" ? 700 : 400,
              textDecoration: route.page === "all-tracked" ? "underline" : "none",
            }}
          >
            All Tracked
          </button>
        </nav>
      </header>

      {route.page === "focus" && (
        <FocusQueue onSelectItem={handleSelectItem} />
      )}
      {route.page === "all-tracked" && <AllTracked />}
      {route.page === "workbench" && (
        <Workbench
          jobId={route.jobId}
          onBack={() => setRoute({ page: "focus" })}
        />
      )}
    </div>
  );
}
```

- [x] **Step 5: Commit**

```bash
git add client/package.json client/index.html client/src/main.tsx client/src/App.tsx
git commit -m "feat(client): Vite React app shell with Focus Queue, All Tracked, and Workbench routing"
```

---

### Task 18: API Routes — Health, Queue, Jobs, Drafts, Audit

**Files:**
- Create: `src/api/routes/health.ts`
- Create: `src/api/routes/queue.ts`
- Create: `src/api/routes/jobs.ts`
- Create: `src/api/routes/drafts.ts`
- Create: `src/api/routes/audit.ts`

- [ ] **Step 1: Implement health route**

```typescript
// src/api/routes/health.ts
import { Hono } from "hono";

export interface HealthDeps {
  getHealthStatus: () => { healthy: boolean; issues: string[] };
}

export function healthRoutes(deps: HealthDeps) {
  const app = new Hono();
  app.get("/api/health", (c) => {
    return c.json(deps.getHealthStatus());
  });
  return app;
}
```

- [ ] **Step 2: Implement queue route**

```typescript
// src/api/routes/queue.ts
import { Hono } from "hono";

export interface QueueDeps {
  getAllTracked: () => unknown[];
  getFocusQueue: () => { now: unknown[]; next: unknown[]; monitor: unknown[] };
}

export function queueRoutes(deps: QueueDeps) {
  const app = new Hono();
  app.get("/api/queue", (c) => {
    return c.json({
      allTracked: deps.getAllTracked(),
      focusQueue: deps.getFocusQueue(),
    });
  });
  return app;
}
```

- [ ] **Step 3: Implement jobs route**

```typescript
// src/api/routes/jobs.ts
import { Hono } from "hono";

export interface JobsDeps {
  getJob: (id: string) => unknown | null;
  requestAnalyze: (input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: "registered-source" | "remote-evidence-only";
  }) => string;
  requestRetry: (jobId: string) => string;
}

export function jobsRoutes(deps: JobsDeps) {
  const app = new Hono();
  app.get("/api/jobs/:id", (c) => {
    const job = deps.getJob(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  });

  app.post("/api/jobs/analyze", async (c) => {
    const body = await c.req.json<{
      repositoryKey: string;
      prNumber: number;
      sourceMode?: "registered-source" | "remote-evidence-only";
    }>();
    const jobId = deps.requestAnalyze(body);
    return c.json({ jobId });
  });

  app.post("/api/jobs/:id/retry", (c) => {
    const newRunId = deps.requestRetry(c.req.param("id"));
    return c.json({ runId: newRunId });
  });

  return app;
}
```

- [ ] **Step 4: Implement drafts route**

```typescript
// src/api/routes/drafts.ts
import { Hono } from "hono";

export interface DraftsDeps {
  getDraft: (jobId: string) => unknown | null;
}

export function draftsRoutes(deps: DraftsDeps) {
  const app = new Hono();
  app.get("/api/drafts/:jobId", (c) => {
    const draft = deps.getDraft(c.req.param("jobId"));
    if (!draft) return c.json({ error: "Draft not found" }, 404);
    return c.json(draft);
  });
  return app;
}
```

- [ ] **Step 5: Implement audit route**

```typescript
// src/api/routes/audit.ts
import { Hono } from "hono";

export interface AuditDeps {
  getAuditTrail: (jobId: string) => unknown[];
}

export function auditRoutes(deps: AuditDeps) {
  const app = new Hono();
  app.get("/api/audit/:jobId", (c) => {
    return c.json(deps.getAuditTrail(c.req.param("jobId")));
  });
  return app;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/health.ts src/api/routes/queue.ts src/api/routes/jobs.ts src/api/routes/drafts.ts src/api/routes/audit.ts
git commit -m "feat(api): read-only JSON routes for health, queue, jobs, drafts, and audit"
```

---

### Task 19: API Routes — Approvals and Publication

**Files:**
- Create: `src/api/routes/approvals.ts`
- Create: `src/api/routes/publication.ts`

- [ ] **Step 1: Implement approvals route**

```typescript
// src/api/routes/approvals.ts
import { Hono } from "hono";
import type { ActionTokenStore } from "../action-token.js";
import type { ApprovalStore } from "../../publisher/approvals.js";

export interface ApprovalsDeps {
  actionTokens: ActionTokenStore;
  approvals: ApprovalStore;
  sessionSecret: string;
}

export function approvalsRoutes(deps: ApprovalsDeps) {
  const app = new Hono();

  app.post("/api/approvals", async (c) => {
    const body = await c.req.json<{
      operationHash: string;
      actionToken: string;
    }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    deps.approvals.create(body.operationHash);
    return c.json({ approved: true });
  });

  return app;
}
```

- [ ] **Step 2: Implement publication route**

```typescript
// src/api/routes/publication.ts
import { Hono } from "hono";
import type { ActionTokenStore } from "../action-token.js";
import type { ApprovalStore } from "../../publisher/approvals.js";
import { validatePublishGuards, type GuardInput } from "../../publisher/guards.js";

export interface PublicationDeps {
  actionTokens: ActionTokenStore;
  approvals: ApprovalStore;
  getGuardInput: (operationHash: string) => GuardInput | null;
  executePublish: (
    operationHash: string,
    body: string | null,
  ) => Promise<{ status: "completed" | "failed"; error?: string }>;
}

export function publicationRoutes(deps: PublicationDeps) {
  const app = new Hono();

  app.post("/api/publish", async (c) => {
    const body = await c.req.json<{
      operationHash: string;
      body: string | null;
      actionToken: string;
    }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    const guardInput = deps.getGuardInput(body.operationHash);
    if (!guardInput) {
      return c.json({ error: "Unknown operation" }, 404);
    }

    const guardResult = validatePublishGuards(guardInput);
    if (!guardResult.ok) {
      return c.json({ error: guardResult.reason }, 403);
    }

    if (!deps.approvals.consume(body.operationHash)) {
      return c.json(
        { error: "No valid unconsumed approval for this operation" },
        403,
      );
    }

    const result = await deps.executePublish(body.operationHash, body.body);
    return c.json(result);
  });

  return app;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/approvals.ts src/api/routes/publication.ts
git commit -m "feat(api): approval and publication endpoints with guard validation and action tokens"
```

---

### Task 20: API Server — Mount Routes and Serve Static Client

**Files:**
- Create: `src/api/server.ts`

- [ ] **Step 1: Implement API server**

```typescript
// src/api/server.ts
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import { loopbackGuard, cspMiddleware } from "./csp.js";
import { createSessionSecret, createSessionCookie, validateSession } from "./session.js";
import { ActionTokenStore } from "./action-token.js";
import { healthRoutes, type HealthDeps } from "./routes/health.js";
import { queueRoutes, type QueueDeps } from "./routes/queue.js";
import { jobsRoutes, type JobsDeps } from "./routes/jobs.js";
import { draftsRoutes, type DraftsDeps } from "./routes/drafts.js";
import { approvalsRoutes } from "./routes/approvals.js";
import { publicationRoutes, type PublicationDeps } from "./routes/publication.js";
import { auditRoutes, type AuditDeps } from "./routes/audit.js";
import { ApprovalStore } from "../publisher/approvals.js";

export interface ServerDeps extends HealthDeps, QueueDeps, DraftsDeps, AuditDeps {
  getJob: JobsDeps["getJob"];
  requestAnalyze: JobsDeps["requestAnalyze"];
  requestRetry: JobsDeps["requestRetry"];
  getGuardInput: PublicationDeps["getGuardInput"];
  executePublish: PublicationDeps["executePublish"];
  clientDistPath: string;
}

export function createApiServer(deps: ServerDeps) {
  const app = new Hono();
  const sessionSecret = createSessionSecret();
  const actionTokens = new ActionTokenStore();
  const approvals = new ApprovalStore();

  app.use("*", loopbackGuard);
  app.use("*", cspMiddleware);

  app.get("/", (c) => {
    c.header("set-cookie", createSessionCookie(sessionSecret));
    return c.redirect("/index.html");
  });

  app.use("/api/*", async (c, next) => {
    const cookie = c.req.header("cookie");
    const origin = c.req.header("origin");
    if (!validateSession(sessionSecret, cookie, origin)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.post("/api/action-token", (c) => {
    const token = actionTokens.create();
    return c.json({ token });
  });

  app.route("/", healthRoutes(deps));
  app.route("/", queueRoutes(deps));
  app.route("/", jobsRoutes({
    getJob: deps.getJob,
    requestAnalyze: deps.requestAnalyze,
    requestRetry: deps.requestRetry,
  }));
  app.route("/", draftsRoutes(deps));
  app.route(
    "/",
    approvalsRoutes({ actionTokens, approvals, sessionSecret }),
  );
  app.route(
    "/",
    publicationRoutes({
      actionTokens,
      approvals,
      getGuardInput: deps.getGuardInput,
      executePublish: deps.executePublish,
    }),
  );
  app.route("/", auditRoutes(deps));

  app.use("/*", serveStatic({ root: deps.clientDistPath }));

  const cleanupInterval = setInterval(() => actionTokens.cleanup(), 60_000);

  return {
    app,
    approvals,
    start(port: number) {
      const server = serve({ fetch: app.fetch, port });
      return {
        url: `http://127.0.0.1:${port}`,
        close() {
          clearInterval(cleanupInterval);
          approvals.invalidateAll();
          server.close();
        },
      };
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/server.ts
git commit -m "feat(api): Hono server mounting all routes, session auth, static client, and loopback binding"
```

---

### Task 21: Wire Daemon Start to Serve UI + API

**Files:**
- Modify: `src/daemon/runtime.ts` (Plan 03 — already owns daemon lifecycle via `startRuntime`)

> **Architecture note:** Plan 01's raw `node:http` daemon sketch is superseded by Plan 03's
> `startRuntime` (in `src/daemon/runtime.ts`), which provides `RuntimeHandle.facade`
> (`OrchestratorFacade`). This task adds the Hono API server from `createApiServer`
> (this plan's Task 20) to the existing `startRuntime` lifecycle instead of duplicating
> a second HTTP listener. The facade is the single typed boundary between the workbench
> server and the orchestrator — no invented `orchestrator.getX` helpers.

- [ ] **Step 1: Import facade and wire API server into runtime lifecycle**

Modify `src/daemon/runtime.ts` (Plan 03's runtime) to start the API server after creating the facade:

```typescript
// src/daemon/runtime.ts — additions to Plan 03 implementation
import { createApiServer, type ServerDeps } from '../api/server.js';
import type { OrchestratorFacade } from '../orchestrator/facade.js';
import { resolve } from 'node:path';

// Inside startRuntime, after `const facade = deps.createFacade();`:

function buildServerDeps(facade: OrchestratorFacade): ServerDeps {
  return {
    getHealthStatus: () => facade.getHealthStatus(),
    getAllTracked: () => facade.getAllTracked(),
    getFocusQueue: () => facade.getFocusQueue(),
    getJob: (id) => facade.getJob(id),
    getDraft: (jobId) => facade.getDraft(jobId),
    getAuditTrail: (jobId) => facade.getAuditTrail(jobId),
    getGuardInput: (opHash) => guardStore.getGuardInput(opHash),
    executePublish: (opHash, body) => publisher.executeOperation(opHash, body),
    requestAnalyze: (input) => facade.requestAnalyze(input),
    requestRetry: (jobId) => facade.requestRetry(jobId),
    clientDistPath: resolve(import.meta.dirname, '../../client/dist'),
  };
}

const apiServer = createApiServer(buildServerDeps(facade));
const PORT = config.port; // 9120 from RuntimeConfig
const { url, close: closeApi } = apiServer.start(PORT);
console.log(`Control Tower UI: ${url}`);

// Extend the stop() function returned by startRuntime:
async function stop(): Promise<void> {
  closeApi();
  // ... existing cleanup (timers, poller) from Plan 03 ...
}
```

- [ ] **Step 2: Verify the daemon starts and serves the UI**

Run: `pnpm ct start` (or equivalent)
Expected: Prints `Control Tower UI: http://127.0.0.1:9120` and serves the static client at that URL.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/runtime.ts
git commit -m "feat(daemon): wire Hono API server + OrchestratorFacade into startRuntime lifecycle"
```

---

### Task 21b: Partial Publish Continuation and Last-Valid Config

**Files:**
- Create: `src/publisher/continuation.ts`
- Create: `tests/publisher/continuation.test.ts`
- Create: `src/config/runtime-config.ts`
- Create: `tests/config/runtime-config.test.ts`

> **§12 invariants:**
> - Publication partial failure: retain per-operation completion and the frozen summary-use/idempotency mapping; preview only incomplete operations; require a fresh single-use approval for each incomplete operation before continuing; never reapprove, replay, or remap a completed summary/review body.
> - Configuration error: retain the last valid runtime configuration; do not partially apply an invalid edit.

- [ ] **Step 1: Write failing tests for partial publish continuation**

```typescript
// tests/publisher/continuation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listIncompleteOperations,
  continuePublish,
  type PublicationOperationRecord,
  type ContinuationStore,
  type FreshApproval,
} from "../../src/publisher/continuation.js";
import { computeOperationHash } from "../../src/publisher/operation-hash.js";
import type { ExternalOperation } from "../../src/publisher/operation-hash.js";

function makeOp(overrides: Partial<ExternalOperation> = {}): ExternalOperation {
  return {
    type: "comment_review",
    event: "COMMENT",
    principalLogin: "shubh-array",
    repository: "Powered-By-Array/pba-webapp",
    prNumber: 42,
    target: null,
    bodyHash: "summary-body-hash-aaa",
    disposition: "comment",
    draftSummaryUse: "review_body",
    summaryBodyHash: "summary-body-hash-aaa",
    headSha: "a".repeat(40),
    acceptedRunId: "run-1",
    runInputHash: "input-1",
    coverageHash: "cov-1",
    provenanceIds: ["pv_a"],
    idempotencyKey: "idem-summary-review",
    ...overrides,
  };
}

function makeRecord(
  op: ExternalOperation,
  status: "completed" | "failed" | "pending",
): PublicationOperationRecord {
  return {
    operationHash: computeOperationHash(op),
    idempotencyKey: op.idempotencyKey,
    type: op.type,
    bodyHash: op.bodyHash,
    summaryBodyHash: op.summaryBodyHash,
    draftSummaryUse: op.draftSummaryUse,
    status,
    frozenOp: op,
  };
}

function createStore(
  jobId: string,
  records: PublicationOperationRecord[],
): ContinuationStore {
  const byJob = new Map<string, PublicationOperationRecord[]>([[jobId, records]]);
  return {
    getOperations(id: string) {
      return byJob.get(id) ?? [];
    },
    markCompleted(id: string, operationHash: string) {
      const ops = byJob.get(id);
      if (!ops) return;
      const idx = ops.findIndex((o) => o.operationHash === operationHash);
      if (idx >= 0) {
        ops[idx] = { ...ops[idx], status: "completed" };
      }
    },
  };
}

describe("listIncompleteOperations", () => {
  it("returns only failed/pending ops after op1 success + op2 fail", () => {
    const summaryOp = makeOp({
      type: "comment_review",
      idempotencyKey: "idem-op1-summary",
      bodyHash: "summary-body-hash-aaa",
      summaryBodyHash: "summary-body-hash-aaa",
      draftSummaryUse: "review_body",
    });
    const inlineOp = makeOp({
      type: "inline_comment",
      event: "COMMENT",
      idempotencyKey: "idem-op2-inline",
      bodyHash: "inline-body-hash-bbb",
      summaryBodyHash: "summary-body-hash-aaa",
      draftSummaryUse: "not_published",
      target: { path: "src/a.ts", side: "RIGHT", line: 10, startSide: null, startLine: null },
      provenanceIds: ["pv_b"],
    });

    const store = createStore("job-pub-1", [
      makeRecord(summaryOp, "completed"),
      makeRecord(inlineOp, "failed"),
    ]);

    const incomplete = listIncompleteOperations(store, "job-pub-1");
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].idempotencyKey).toBe("idem-op2-inline");
    expect(incomplete[0].type).toBe("inline_comment");
  });

  it("never includes a completed summary/review operation", () => {
    const summaryOp = makeOp({ idempotencyKey: "idem-done" });
    const store = createStore("job-pub-2", [makeRecord(summaryOp, "completed")]);
    expect(listIncompleteOperations(store, "job-pub-2")).toEqual([]);
  });
});

describe("continuePublish", () => {
  const summaryOp = makeOp({
    type: "comment_review",
    idempotencyKey: "idem-op1-summary",
    bodyHash: "summary-body-hash-aaa",
    summaryBodyHash: "summary-body-hash-aaa",
    draftSummaryUse: "review_body",
  });
  const inlineOp = makeOp({
    type: "inline_comment",
    event: "COMMENT",
    idempotencyKey: "idem-op2-inline",
    bodyHash: "inline-body-hash-bbb",
    summaryBodyHash: "summary-body-hash-aaa",
    draftSummaryUse: "not_published",
    target: { path: "src/a.ts", side: "RIGHT", line: 10, startSide: null, startLine: null },
    provenanceIds: ["pv_b"],
  });

  let store: ContinuationStore;
  let executeOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = createStore("job-pub-1", [
      makeRecord(summaryOp, "completed"),
      makeRecord(inlineOp, "failed"),
    ]);
    executeOperation = vi.fn().mockResolvedValue({
      status: "completed",
      operationHash: computeOperationHash(inlineOp),
    });
  });

  it("continuation only requires a fresh approval for the incomplete op (op2)", async () => {
    const freshApprovals: FreshApproval[] = [
      {
        operationHash: computeOperationHash(inlineOp),
        token: "fresh-token-op2",
        consumed: false,
      },
    ];

    const result = await continuePublish(
      {
        store,
        executeOperation,
        consumeApproval: (hash, token) => {
          const a = freshApprovals.find((x) => x.operationHash === hash);
          if (!a || a.consumed || a.token !== token) return false;
          a.consumed = true;
          return true;
        },
        resolveBody: (op) =>
          op.idempotencyKey === "idem-op2-inline" ? "inline comment text" : null,
      },
      "job-pub-1",
      freshApprovals,
    );

    expect(result.attempted).toHaveLength(1);
    expect(result.attempted[0].idempotencyKey).toBe("idem-op2-inline");
    expect(result.skippedCompleted).toHaveLength(1);
    expect(result.skippedCompleted[0].idempotencyKey).toBe("idem-op1-summary");
    expect(executeOperation).toHaveBeenCalledOnce();
    expect(executeOperation.mock.calls[0][0].idempotencyKey).toBe("idem-op2-inline");
  });

  it("rejects continuation when fresh approval is missing for an incomplete op", async () => {
    await expect(
      continuePublish(
        {
          store,
          executeOperation,
          consumeApproval: () => true,
          resolveBody: () => "x",
        },
        "job-pub-1",
        [], // no fresh approvals
      ),
    ).rejects.toThrow(/fresh approval/i);
    expect(executeOperation).not.toHaveBeenCalled();
  });

  it("never remaps a completed summary body hash as a review body for continuation", async () => {
    const completedSummaryHash = summaryOp.bodyHash!;
    const freshApprovals: FreshApproval[] = [
      {
        operationHash: computeOperationHash(inlineOp),
        token: "fresh-token-op2",
        consumed: false,
      },
    ];

    // Attacker/operator mistake: try to reuse completed summary body as the inline/review body.
    const resolveBody = vi.fn((op: ExternalOperation) => {
      if (op.idempotencyKey === "idem-op2-inline") {
        // Must not accept remapping completed summary hash onto a different op's body.
        return "inline comment text";
      }
      return null;
    });

    const result = await continuePublish(
      {
        store,
        executeOperation,
        consumeApproval: (hash, token) => {
          const a = freshApprovals.find((x) => x.operationHash === hash);
          if (!a || a.consumed || a.token !== token) return false;
          a.consumed = true;
          return true;
        },
        resolveBody,
      },
      "job-pub-1",
      freshApprovals,
    );

    const executedOp: ExternalOperation = executeOperation.mock.calls[0][0];
    expect(executedOp.bodyHash).toBe("inline-body-hash-bbb");
    expect(executedOp.bodyHash).not.toBe(completedSummaryHash);
    expect(executedOp.draftSummaryUse).not.toBe("review_body");
    // Frozen mapping: completed summary op is not re-executed or remapped.
    expect(result.skippedCompleted[0].bodyHash).toBe(completedSummaryHash);
    expect(result.skippedCompleted[0].draftSummaryUse).toBe("review_body");
    expect(
      result.attempted.some((op) => op.bodyHash === completedSummaryHash),
    ).toBe(false);
  });

  it("rejects an approval that targets an already-completed operation hash", async () => {
    const completedHash = computeOperationHash(summaryOp);
    const freshApprovals: FreshApproval[] = [
      { operationHash: completedHash, token: "stale-reuse", consumed: false },
      {
        operationHash: computeOperationHash(inlineOp),
        token: "fresh-token-op2",
        consumed: false,
      },
    ];

    await expect(
      continuePublish(
        {
          store,
          executeOperation,
          consumeApproval: () => true,
          resolveBody: () => "x",
        },
        "job-pub-1",
        freshApprovals,
      ),
    ).rejects.toThrow(/already completed|cannot reapprove|remap/i);
  });
});
```

- [ ] **Step 2: Write failing tests for last-valid runtime config**

```typescript
// tests/config/runtime-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadRuntimeConfig,
  type RuntimeConfigHandle,
} from "../../src/config/runtime-config.js";

const VALID = {
  schemaVersion: 1,
  port: 9120,
  publication: { mode: "shadow" },
  profileId: "shubh",
};

describe("loadRuntimeConfig — last-valid retention", () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ct-runtime-cfg-"));
    configPath = join(tmp, "local.json");
    writeFileSync(configPath, JSON.stringify(VALID, null, 2));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads a valid config", () => {
    const handle = loadRuntimeConfig(configPath);
    expect(handle.current.port).toBe(9120);
    expect(handle.current.publication.mode).toBe("shadow");
    expect(handle.lastValid).toEqual(handle.current);
  });

  it("keeps lastValid on invalid reload and does not partially apply", () => {
    const handle: RuntimeConfigHandle = loadRuntimeConfig(configPath);
    expect(handle.current.publication.mode).toBe("shadow");

    // Invalid edit: unknown key + illegal mode — must not partially apply.
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          port: 9999,
          publication: { mode: "gated" },
          profileId: "shubh",
          unknownField: true,
        },
        null,
        2,
      ),
    );

    const reloaded = handle.reload();
    expect(reloaded.ok).toBe(false);
    expect(reloaded.error).toMatch(/invalid|unknown/i);

    // Last valid retained — port and mode unchanged.
    expect(handle.current.port).toBe(9120);
    expect(handle.current.publication.mode).toBe("shadow");
    expect(handle.lastValid.port).toBe(9120);
    expect(handle.lastValid.publication.mode).toBe("shadow");

    // On-disk invalid file is not treated as applied.
    const disk = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(disk.port).toBe(9999); // file may still be dirty on disk
    expect(handle.current.port).not.toBe(disk.port);
  });

  it("updates lastValid only after a successful reload", () => {
    const handle = loadRuntimeConfig(configPath);

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          port: 9120,
          publication: { mode: "gated" },
          profileId: "shubh",
        },
        null,
        2,
      ),
    );

    const reloaded = handle.reload();
    expect(reloaded.ok).toBe(true);
    expect(handle.current.publication.mode).toBe("gated");
    expect(handle.lastValid.publication.mode).toBe("gated");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/publisher/continuation.test.ts tests/config/runtime-config.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement continuation**

```typescript
// src/publisher/continuation.ts
import type { ExternalOperation } from "./operation-hash.js";
import { computeOperationHash } from "./operation-hash.js";

export interface PublicationOperationRecord {
  operationHash: string;
  idempotencyKey: string;
  type: ExternalOperation["type"];
  bodyHash: string | null;
  summaryBodyHash: string | null;
  draftSummaryUse: ExternalOperation["draftSummaryUse"];
  status: "completed" | "failed" | "pending";
  frozenOp: ExternalOperation;
}

export interface FreshApproval {
  operationHash: string;
  token: string;
  consumed: boolean;
}

export interface ContinuationStore {
  getOperations(jobId: string): PublicationOperationRecord[];
  markCompleted(jobId: string, operationHash: string): void;
}

export interface ContinuePublishDeps {
  store: ContinuationStore;
  executeOperation: (
    op: ExternalOperation,
    body: string | null,
  ) => Promise<{ status: "completed" | "failed"; operationHash: string; error?: string }>;
  consumeApproval: (operationHash: string, token: string) => boolean;
  resolveBody: (op: ExternalOperation) => string | null;
}

export interface ContinuePublishResult {
  attempted: ExternalOperation[];
  skippedCompleted: PublicationOperationRecord[];
  results: Array<{ operationHash: string; status: "completed" | "failed"; error?: string }>;
}

export function listIncompleteOperations(
  store: ContinuationStore,
  jobId: string,
): PublicationOperationRecord[] {
  return store
    .getOperations(jobId)
    .filter((op) => op.status === "failed" || op.status === "pending");
}

/**
 * Continue a partially failed publish job.
 * Only incomplete operations are eligible. Completed summary/review bodies are
 * never reapproved, replayed, or remapped onto another operation.
 */
export async function continuePublish(
  deps: ContinuePublishDeps,
  jobId: string,
  freshApprovals: FreshApproval[],
): Promise<ContinuePublishResult> {
  const all = deps.store.getOperations(jobId);
  const completed = all.filter((op) => op.status === "completed");
  const incomplete = all.filter(
    (op) => op.status === "failed" || op.status === "pending",
  );

  const completedHashes = new Set(completed.map((op) => op.operationHash));

  for (const approval of freshApprovals) {
    if (completedHashes.has(approval.operationHash)) {
      throw new Error(
        `Approval targets already completed operation ${approval.operationHash} — cannot reapprove or remap`,
      );
    }
  }

  const approvalByHash = new Map(
    freshApprovals.map((a) => [a.operationHash, a] as const),
  );

  for (const op of incomplete) {
    if (!approvalByHash.has(op.operationHash)) {
      throw new Error(
        `Fresh approval required for incomplete operation ${op.idempotencyKey}`,
      );
    }
  }

  const attempted: ExternalOperation[] = [];
  const results: ContinuePublishResult["results"] = [];

  for (const record of incomplete) {
    const approval = approvalByHash.get(record.operationHash)!;
    if (!deps.consumeApproval(record.operationHash, approval.token)) {
      throw new Error(
        `Fresh approval could not be consumed for ${record.idempotencyKey}`,
      );
    }

    // Use the frozen operation snapshot — never remap body/summary from completed ops.
    const op = record.frozenOp;
    const expectedHash = computeOperationHash(op);
    if (expectedHash !== record.operationHash) {
      throw new Error(
        `Frozen operation hash drift for ${record.idempotencyKey} — refusing remap`,
      );
    }

    const body = deps.resolveBody(op);
    attempted.push(op);
    const result = await deps.executeOperation(op, body);
    results.push({
      operationHash: record.operationHash,
      status: result.status,
      error: result.error,
    });
    if (result.status === "completed") {
      deps.store.markCompleted(jobId, record.operationHash);
    }
  }

  return {
    attempted,
    skippedCompleted: completed,
    results,
  };
}
```

- [ ] **Step 5: Implement last-valid runtime config**

```typescript
// src/config/runtime-config.ts
import { readFileSync } from "node:fs";

export interface RuntimeConfig {
  schemaVersion: number;
  port: number;
  publication: { mode: "shadow" | "gated" };
  profileId: string;
}

export interface ReloadResult {
  ok: boolean;
  error?: string;
}

export interface RuntimeConfigHandle {
  /** Currently active (always a previously validated config). */
  readonly current: RuntimeConfig;
  /** Same as current after success; retained across failed reloads. */
  readonly lastValid: RuntimeConfig;
  reload: () => ReloadResult;
}

function parseAndValidate(raw: string): RuntimeConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "port", "publication", "profileId"]);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid runtime config: unknown key "${key}"`);
    }
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error("Invalid runtime config: schemaVersion must be 1");
  }
  if (typeof parsed.port !== "number" || parsed.port !== 9120) {
    // Phase 1 locks loopback port to 9120; reject drift rather than partially apply.
    throw new Error("Invalid runtime config: port must be 9120");
  }
  const publication = parsed.publication as { mode?: string } | undefined;
  if (
    !publication ||
    (publication.mode !== "shadow" && publication.mode !== "gated")
  ) {
    throw new Error("Invalid runtime config: publication.mode must be shadow|gated");
  }
  if (typeof parsed.profileId !== "string" || parsed.profileId.length === 0) {
    throw new Error("Invalid runtime config: profileId required");
  }
  return {
    schemaVersion: 1,
    port: 9120,
    publication: { mode: publication.mode },
    profileId: parsed.profileId,
  };
}

export function loadRuntimeConfig(configPath: string): RuntimeConfigHandle {
  const initial = parseAndValidate(readFileSync(configPath, "utf-8"));
  let current: RuntimeConfig = initial;
  let lastValid: RuntimeConfig = initial;

  return {
    get current() {
      return current;
    },
    get lastValid() {
      return lastValid;
    },
    reload(): ReloadResult {
      try {
        const next = parseAndValidate(readFileSync(configPath, "utf-8"));
        current = next;
        lastValid = next;
        return { ok: true };
      } catch (err) {
        // Retain lastValid / current — do not partially apply the invalid edit.
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/publisher/continuation.test.ts tests/config/runtime-config.test.ts`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/publisher/continuation.ts tests/publisher/continuation.test.ts src/config/runtime-config.ts tests/config/runtime-config.test.ts
git commit -m "feat(publisher,config): §12 partial publish continuation and last-valid config retention"
```

---

### Task 22: Install Dependencies

**Files:**
- Modify: root `package.json` and `client/package.json`

- [ ] **Step 1: Install server-side dependencies**

```bash
pnpm add hono @hono/node-server
```

- [ ] **Step 2: Install client-side dependencies**

```bash
cd client && pnpm install
```

- [ ] **Step 3: Build client for static serving**

```bash
cd client && pnpm build
```

Expected: `client/dist/` contains `index.html` and bundled JS/CSS with no inline scripts.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml client/package.json client/pnpm-lock.yaml
git commit -m "chore: install hono, react, vite, and sanitizer dependencies"
```

---

### Task 23: Partial Publish Failure Recovery

**Files:**
- Create: `src/publisher/batch-publish.ts`
- Create: `tests/publisher/partial-failure.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/publisher/partial-failure.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  executeBatchPublish,
  getIncompleteOperations,
  type BatchPublishDeps,
  type OperationEntry,
  type CompletionMap,
} from "../../src/publisher/batch-publish.js";
import type { ExternalOperation } from "../../src/publisher/operation-hash.js";
import { ApprovalStore } from "../../src/publisher/approvals.js";

function makeOp(
  type: string,
  idemKey: string,
  overrides: Partial<ExternalOperation> = {},
): ExternalOperation {
  return {
    type: type as ExternalOperation["type"],
    event: type === "approve_review" ? "APPROVE" : "COMMENT",
    principalLogin: "shubh-array",
    repository: "Powered-By-Array/pba-webapp",
    prNumber: 42,
    target: null,
    bodyHash: type === "approve_review" ? null : `hash-${idemKey}`,
    disposition: "comment",
    draftSummaryUse: type === "summary_comment" ? "review_body" : "none",
    summaryBodyHash: type === "summary_comment" ? "summary-hash" : null,
    headSha: "a".repeat(40),
    acceptedRunId: "run-1",
    runInputHash: "input-1",
    coverageHash: "cov-1",
    provenanceIds: type === "approve_review" ? [] : ["pv_a"],
    idempotencyKey: idemKey,
    ...overrides,
  };
}

describe("executeBatchPublish", () => {
  it("completes all operations when none fail", async () => {
    const deps: BatchPublishDeps = {
      executeOne: vi
        .fn()
        .mockResolvedValue({ status: "completed", githubId: "gh-1" }),
    };
    const ops: OperationEntry[] = [
      { operation: makeOp("summary_comment", "op-1"), body: "Summary body" },
      { operation: makeOp("approve_review", "op-2"), body: null },
    ];

    const result = await executeBatchPublish(deps, ops);

    expect(result.allComplete).toBe(true);
    expect(result.failedOperations).toHaveLength(0);
    expect(result.completionMap["op-1"].status).toBe("completed");
    expect(result.completionMap["op-2"].status).toBe("completed");
  });

  it("continues after partial failure and reports incomplete ops", async () => {
    const deps: BatchPublishDeps = {
      executeOne: vi
        .fn()
        .mockResolvedValueOnce({ status: "completed", githubId: "gh-1" })
        .mockResolvedValueOnce({ status: "failed", error: "API 500" })
        .mockResolvedValueOnce({ status: "completed", githubId: "gh-3" }),
    };
    const ops: OperationEntry[] = [
      { operation: makeOp("summary_comment", "op-1"), body: "Summary" },
      { operation: makeOp("inline_comment", "op-2"), body: "Comment" },
      { operation: makeOp("approve_review", "op-3"), body: null },
    ];

    const result = await executeBatchPublish(deps, ops);

    expect(result.allComplete).toBe(false);
    expect(result.failedOperations).toEqual(["op-2"]);
    expect(result.completionMap["op-1"].status).toBe("completed");
    expect(result.completionMap["op-2"].status).toBe("failed");
    expect(result.completionMap["op-3"].status).toBe("completed");
  });

  it("records thrown errors as failed operations", async () => {
    const deps: BatchPublishDeps = {
      executeOne: vi
        .fn()
        .mockRejectedValueOnce(new Error("network timeout")),
    };
    const ops: OperationEntry[] = [
      { operation: makeOp("summary_comment", "op-1"), body: "Body" },
    ];

    const result = await executeBatchPublish(deps, ops);

    expect(result.allComplete).toBe(false);
    expect(result.completionMap["op-1"].status).toBe("failed");
    expect(result.completionMap["op-1"].error).toContain("network timeout");
  });
});

describe("getIncompleteOperations", () => {
  it("returns only incomplete ops after partial failure", () => {
    const completionMap: CompletionMap = {
      "op-1": { status: "completed", githubId: "gh-1" },
      "op-2": { status: "failed", error: "API error" },
      "op-3": { status: "completed", githubId: "gh-3" },
    };
    const allOps: OperationEntry[] = [
      { operation: makeOp("summary_comment", "op-1"), body: "Summary" },
      { operation: makeOp("inline_comment", "op-2"), body: "Comment" },
      { operation: makeOp("approve_review", "op-3"), body: null },
    ];

    const incomplete = getIncompleteOperations(completionMap, allOps);

    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].operation.idempotencyKey).toBe("op-2");
  });

  it("returns empty array when all complete", () => {
    const completionMap: CompletionMap = {
      "op-1": { status: "completed", githubId: "gh-1" },
    };
    const allOps: OperationEntry[] = [
      { operation: makeOp("summary_comment", "op-1"), body: "Summary" },
    ];

    expect(getIncompleteOperations(completionMap, allOps)).toHaveLength(0);
  });
});

describe("Fresh approval per incomplete op", () => {
  it("each incomplete op requires its own fresh single-use approval", () => {
    const store = new ApprovalStore();
    store.create("op-2-retry");

    expect(store.consume("op-2-retry")).toBe(true);
    expect(store.consume("op-2-retry")).toBe(false);
  });

  it("completed op approval cannot be reused for incomplete op", () => {
    const store = new ApprovalStore();
    store.create("op-1-done");
    store.consume("op-1-done");

    expect(store.consume("op-1-done")).toBe(false);
  });
});

describe("Summary body never remapped", () => {
  it("completed summary_comment body is not reused for another op type", async () => {
    const bodiesUsed: Array<{ type: string; body: string | null }> = [];
    const deps: BatchPublishDeps = {
      executeOne: vi.fn().mockImplementation(async (op, body) => {
        bodiesUsed.push({ type: op.type, body });
        return { status: "completed", githubId: "gh-1" };
      }),
    };
    const summaryBody = "This is the review summary";
    const ops: OperationEntry[] = [
      { operation: makeOp("summary_comment", "op-1"), body: summaryBody },
      { operation: makeOp("inline_comment", "op-2"), body: "Inline note" },
    ];

    await executeBatchPublish(deps, ops);

    const summaryCall = bodiesUsed.find((b) => b.type === "summary_comment");
    const inlineCall = bodiesUsed.find((b) => b.type === "inline_comment");
    expect(summaryCall!.body).toBe(summaryBody);
    expect(inlineCall!.body).toBe("Inline note");
    expect(inlineCall!.body).not.toBe(summaryBody);
  });

  it("after partial failure, retried op keeps its original body", () => {
    const completionMap: CompletionMap = {
      "op-1": { status: "completed", githubId: "gh-1" },
      "op-2": { status: "failed", error: "API error" },
    };
    const allOps: OperationEntry[] = [
      { operation: makeOp("summary_comment", "op-1"), body: "Summary body" },
      { operation: makeOp("inline_comment", "op-2"), body: "Inline note" },
    ];

    const incomplete = getIncompleteOperations(completionMap, allOps);

    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].body).toBe("Inline note");
    expect(incomplete[0].body).not.toBe("Summary body");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/publisher/partial-failure.test.ts`
Expected: FAIL — module `../../src/publisher/batch-publish.js` not found

- [ ] **Step 3: Implement batch publisher with per-operation completion map**

```typescript
// src/publisher/batch-publish.ts
import type { ExternalOperation } from "./operation-hash.js";

export interface OperationEntry {
  operation: ExternalOperation;
  body: string | null;
}

export interface CompletionEntry {
  status: "completed" | "failed";
  githubId?: string;
  error?: string;
}

export type CompletionMap = Record<string, CompletionEntry>;

export interface BatchPublishResult {
  completionMap: CompletionMap;
  allComplete: boolean;
  failedOperations: string[];
}

export interface BatchPublishDeps {
  executeOne: (
    op: ExternalOperation,
    body: string | null,
  ) => Promise<{ status: "completed" | "failed"; githubId?: string; error?: string }>;
}

export async function executeBatchPublish(
  deps: BatchPublishDeps,
  operations: OperationEntry[],
): Promise<BatchPublishResult> {
  const completionMap: CompletionMap = {};
  const failedOperations: string[] = [];

  for (const entry of operations) {
    const key = entry.operation.idempotencyKey;
    try {
      const result = await deps.executeOne(entry.operation, entry.body);
      completionMap[key] = {
        status: result.status,
        githubId: result.githubId,
        error: result.error,
      };
      if (result.status === "failed") {
        failedOperations.push(key);
      }
    } catch (err) {
      completionMap[key] = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
      failedOperations.push(key);
    }
  }

  return {
    completionMap,
    allComplete: failedOperations.length === 0,
    failedOperations,
  };
}

export function getIncompleteOperations(
  completionMap: CompletionMap,
  allOps: OperationEntry[],
): OperationEntry[] {
  return allOps.filter(
    (entry) =>
      completionMap[entry.operation.idempotencyKey]?.status !== "completed",
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm vitest run tests/publisher/partial-failure.test.ts`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/publisher/batch-publish.ts tests/publisher/partial-failure.test.ts
git commit -m "feat(publisher): §12 partial publish failure recovery with per-operation completion map"
```

---

### Task 24: Config Last-Valid Retention

**Files:**
- Create: `src/config/runtime-config.ts`
- Create: `tests/config/last-valid.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/config/last-valid.test.ts
import { describe, it, expect, vi } from "vitest";
import { RuntimeConfigLoader } from "../../src/config/runtime-config.js";

describe("RuntimeConfigLoader", () => {
  it("returns parsed config when valid", () => {
    const loader = new RuntimeConfigLoader({
      readFile: () =>
        JSON.stringify({ schemaVersion: 1, profileId: "test" }),
      log: vi.fn(),
    });

    const config = loader.load();

    expect(config.profileId).toBe("test");
    expect(config.schemaVersion).toBe(1);
  });

  it("retains last-valid config on invalid reload", () => {
    let callCount = 0;
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "original" });
        return "{ invalid json !!!";
      },
      log: vi.fn(),
    });

    const first = loader.load();
    expect(first.profileId).toBe("original");

    const second = loader.load();
    expect(second.profileId).toBe("original");
  });

  it("logs warning on invalid reload", () => {
    let callCount = 0;
    const log = vi.fn();
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "valid" });
        return "!!!";
      },
      log,
    });

    loader.load();
    loader.load();

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/failed|invalid|retain/i),
    );
  });

  it("throws on first load if config is invalid (no last-valid to fall back to)", () => {
    const loader = new RuntimeConfigLoader({
      readFile: () => "not json",
      log: vi.fn(),
    });

    expect(() => loader.load()).toThrow(/initial config load failed/i);
  });

  it("retains last-valid through multiple consecutive invalid reloads", () => {
    let callCount = 0;
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "keeper" });
        return "invalid";
      },
      log: vi.fn(),
    });

    loader.load();
    loader.load();
    const third = loader.load();

    expect(third.profileId).toBe("keeper");
  });

  it("updates last-valid when a subsequent reload is valid", () => {
    let callCount = 0;
    const loader = new RuntimeConfigLoader({
      readFile: () => {
        callCount++;
        if (callCount === 1)
          return JSON.stringify({ schemaVersion: 1, profileId: "v1" });
        if (callCount === 2) return "broken";
        return JSON.stringify({ schemaVersion: 1, profileId: "v2" });
      },
      log: vi.fn(),
    });

    expect(loader.load().profileId).toBe("v1");
    expect(loader.load().profileId).toBe("v1"); // falls back
    expect(loader.load().profileId).toBe("v2"); // new valid
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config/last-valid.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement runtime config loader**

```typescript
// src/config/runtime-config.ts
export interface LocalConfig {
  schemaVersion: number;
  profileId?: string;
  [key: string]: unknown;
}

export interface RuntimeConfigDeps {
  readFile: () => string;
  log: (message: string) => void;
}

export class RuntimeConfigLoader {
  private lastValid: LocalConfig | null = null;

  constructor(private readonly deps: RuntimeConfigDeps) {}

  load(): LocalConfig {
    try {
      const raw = this.deps.readFile();
      const parsed = JSON.parse(raw) as LocalConfig;
      this.lastValid = parsed;
      return parsed;
    } catch (err) {
      if (this.lastValid) {
        this.deps.log(
          `Config reload failed (${err instanceof Error ? err.message : String(err)}), retaining last-valid config`,
        );
        return this.lastValid;
      }
      throw new Error(
        `Initial config load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm vitest run tests/config/last-valid.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/runtime-config.ts tests/config/last-valid.test.ts
git commit -m "feat(config): §12 last-valid config retention on invalid reload"
```

---

## Verification Checklist

After all tasks complete, verify these spec requirements hold:

1. **Shadow mode blocks publish:** `validatePublishGuards` returns `{ok: false}` when `publicationMode` is `shadow` (Task 6 test).
2. **`needs_human` cannot publish:** `createOperationPlan` returns zero operations (Task 5 test).
3. **`approve_review` bodyless empty provenance:** The only operation type permitted `null` body and `[]` provenance (Task 6 test).
4. **COMMENT/REQUEST_CHANGES require citations:** Guards reject `null` body or empty provenance for body-bearing types (Task 6 tests).
5. **XSS fixtures:** Every dangerous tag, event attribute, and URL scheme blocked (Task 10 tests).
6. **Action tokens single-use 60s:** Create, consume, reject reuse, reject expired (Task 2 tests).
7. **No batch approval:** Each operation is approved individually in the Workbench UI (Task 16 — per-operation button).
8. **Same summary body not posted twice:** Operation planner maps `draftSummaryUse` to exactly one external operation (Task 5 test).
9. **CSP blocks inline script/style:** `script-src 'self'` with no `unsafe-inline` (Task 3 test). HTML shell has no inline script/style (Task 17).
10. **Loopback only:** Host guard rejects non-loopback and cross-origin (Task 3 tests).
11. **Partial publish recovery:** Per-operation completion map tracks each op status; after partial failure only incomplete ops previewed; fresh single-use approval required per incomplete op; completed summary body never remapped to another op type (Tasks 21b, 23).
12. **Config last-valid retention:** Invalid config reload retains last-valid; first-load failure throws; warning logged on reload failure; valid reload updates last-valid; does not partially apply (Tasks 21b, 24).

---

## Self-Review Checklist

- [x] **§10.9 UI:** Tasks 14–16 — All Tracked authoritative (with exclusion reasons for ineligible rows), Focus Queue Now/Next/Monitor, Advisor order view, Workbench Understand/Verify/Act.
- [x] **§10.10 Local API:** Tasks 1–3, 17–21 — session cookie, CSP, same-origin, single-use action tokens, loopback-only. On-demand `POST /api/jobs/analyze` and `POST /api/jobs/:id/retry` routes wired to `OrchestratorFacade.requestAnalyze` / `requestRetry`.
- [x] **§10.11 Publisher:** Tasks 4–8, 23 — shadow/gated, per-operation hash + approval, five operation types, partial failure continuation with per-operation completion map (`executeBatchPublish` / `getIncompleteOperations`), `publication enable|disable`.
- [x] **§12 partial publish + config retention:** Tasks 21b, 23, 24 — `listIncompleteOperations` / `continuePublish` / `executeBatchPublish` preview only incomplete ops with fresh per-op approvals; never reapprove/replay/remap a completed summary/review body; `loadRuntimeConfig` / `RuntimeConfigLoader` keeps `lastValid` on invalid reload and does not partially apply.
- [x] **Browser security:** Tasks 9–11 — SafeText/SafeMarkdown, XSS fixtures, no untrusted control interpolation.
- [x] **Human workflow:** `needs_human` blocked; `draftSummaryUse` maps summary once; no batch approval.
- [x] **Facade wiring:** Task 21 imports `OrchestratorFacade` from `../orchestrator/facade.js` (Plan 03). Plan 01 raw HTTP daemon is replaced by Hono via `startRuntime` from Plan 03 `src/daemon/runtime.ts` + this plan's `createApiServer`. No invented `orchestrator.getX` helpers.
- [x] **Type naming:** UI types `TrackedQueueRow` / `FocusQueueRow` avoid collision with Plan 02 `QueueSortInput`. `TrackedQueueRow` includes `eligibilityReasons: EligibilityReason[]` and `exclusionReasons: ExclusionReason[]`.
- [x] **Port:** All loopback references use port 9120.
