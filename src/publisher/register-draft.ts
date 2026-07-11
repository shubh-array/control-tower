import { computeOperationHash } from "./operation-hash.js";
import type { ExternalOperation } from "./operation-hash.js";
import type { GuardInputStore } from "./guard-store.js";
import type { PublisherService } from "./publisher-service.js";

export interface RegisterDraftContext {
  publicationMode: "shadow" | "gated";
  authenticatedLogin: string;
  configuredOperator: string;
  currentHeadSha: string;
  reviewedHeadSha: string;
  acceptedRunId: string;
  approvedRunInputHash: string;
}

export function registerDraftOperations(
  guardStore: GuardInputStore,
  publisher: PublisherService,
  operations: ExternalOperation[],
  ctx: RegisterDraftContext,
): void {
  for (const op of operations) {
    const operationHash = computeOperationHash(op);
    publisher.register(op);
    guardStore.register({
      publicationMode: ctx.publicationMode,
      currentHeadSha: ctx.currentHeadSha,
      reviewedHeadSha: ctx.reviewedHeadSha,
      approvedRunId: ctx.acceptedRunId,
      currentAcceptedRunId: ctx.acceptedRunId,
      approvedRunInputHash: ctx.approvedRunInputHash,
      currentRunInputHash: ctx.approvedRunInputHash,
      operationHash,
      authenticatedLogin: ctx.authenticatedLogin,
      configuredOperator: ctx.configuredOperator,
      operationType: op.type,
      bodyHash: op.bodyHash,
      provenanceIds: op.provenanceIds,
      idempotencyKeyCompleted: false,
    });
  }
}
