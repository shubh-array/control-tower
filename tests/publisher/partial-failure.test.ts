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
    draftSummaryUse: type === "summary_comment" ? "review_body" : "not_published",
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
    expect(result.completionMap["op-1"]!.status).toBe("completed");
    expect(result.completionMap["op-2"]!.status).toBe("completed");
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
    expect(result.completionMap["op-1"]!.status).toBe("completed");
    expect(result.completionMap["op-2"]!.status).toBe("failed");
    expect(result.completionMap["op-3"]!.status).toBe("completed");
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
    expect(result.completionMap["op-1"]!.status).toBe("failed");
    expect(result.completionMap["op-1"]!.error).toContain("network timeout");
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
    expect(incomplete[0]!.operation.idempotencyKey).toBe("op-2");
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
    expect(incomplete[0]!.body).toBe("Inline note");
    expect(incomplete[0]!.body).not.toBe("Summary body");
  });
});
