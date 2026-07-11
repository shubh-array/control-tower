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
