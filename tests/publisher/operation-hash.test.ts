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
