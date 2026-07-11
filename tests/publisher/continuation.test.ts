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
        const existing = ops[idx]!;
        ops[idx] = { ...existing, status: "completed" };
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
    expect(incomplete[0]!.idempotencyKey).toBe("idem-op2-inline");
    expect(incomplete[0]!.type).toBe("inline_comment");
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
    expect(result.attempted[0]!.idempotencyKey).toBe("idem-op2-inline");
    expect(result.skippedCompleted).toHaveLength(1);
    expect(result.skippedCompleted[0]!.idempotencyKey).toBe("idem-op1-summary");
    expect(executeOperation).toHaveBeenCalledOnce();
    expect(executeOperation.mock.calls[0]![0].idempotencyKey).toBe("idem-op2-inline");
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
        [],
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

    const resolveBody = vi.fn((op: ExternalOperation) => {
      if (op.idempotencyKey === "idem-op2-inline") {
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

    const executedOp: ExternalOperation = executeOperation.mock.calls[0]![0];
    expect(executedOp.bodyHash).toBe("inline-body-hash-bbb");
    expect(executedOp.bodyHash).not.toBe(completedSummaryHash);
    expect(executedOp.draftSummaryUse).not.toBe("review_body");
    expect(result.skippedCompleted[0]!.bodyHash).toBe(completedSummaryHash);
    expect(result.skippedCompleted[0]!.draftSummaryUse).toBe("review_body");
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
