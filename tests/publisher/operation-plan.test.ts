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
