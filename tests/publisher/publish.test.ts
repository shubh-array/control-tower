// tests/publisher/publish.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeOperation,
  type PublishContext,
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
