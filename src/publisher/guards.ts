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
      reason: "idempotency key already completed — cannot re-publish",
    };
  }

  return { ok: true };
}
