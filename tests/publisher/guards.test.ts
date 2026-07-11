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
