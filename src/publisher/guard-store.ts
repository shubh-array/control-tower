import type { GuardInput } from "./guards.js";
import type { OperationType } from "./operation-hash.js";

const APPROVAL_TTL_MS = 10 * 60_000;

export interface GuardContext {
  publicationMode: "shadow" | "gated";
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

export class GuardInputStore {
  private contexts = new Map<string, GuardContext>();

  register(context: GuardContext): void {
    this.contexts.set(context.operationHash, context);
  }

  getContext(operationHash: string): GuardContext | null {
    return this.contexts.get(operationHash) ?? null;
  }

  buildGuardInput(
    operationHash: string,
    approval: {
      operationHash: string;
      consumed: boolean;
      createdAt: number;
    } | undefined,
  ): GuardInput | null {
    const ctx = this.contexts.get(operationHash);
    if (!ctx || !approval) return null;
    return {
      ...ctx,
      approval: {
        operationHash: approval.operationHash,
        consumed: approval.consumed,
        createdAt: approval.createdAt,
        ttlMs: APPROVAL_TTL_MS,
      },
    };
  }
}
