import type { ExternalOperation } from "./operation-hash.js";

export interface GhAdapterResult {
  ok: boolean;
  githubId?: string;
  error?: string;
}

export type GhPublishAdapter = (
  op: ExternalOperation,
  body: string | null,
) => Promise<GhAdapterResult>;

export interface PublishContext {
  ghAdapter: GhPublishAdapter;
  authenticatedLogin: string;
  configuredOperator: string;
}

export interface PublishResult {
  operationHash: string;
  idempotencyKey: string;
  status: "completed" | "failed";
  githubId?: string;
  error?: string;
  attemptedAt: number;
}

export async function executeOperation(
  ctx: PublishContext,
  op: ExternalOperation,
  body: string | null,
): Promise<PublishResult> {
  const attemptedAt = Date.now();
  try {
    const result = await ctx.ghAdapter(op, body);
    if (result.ok) {
      return {
        operationHash: op.idempotencyKey,
        idempotencyKey: op.idempotencyKey,
        status: "completed",
        githubId: result.githubId,
        attemptedAt,
      };
    }
    return {
      operationHash: op.idempotencyKey,
      idempotencyKey: op.idempotencyKey,
      status: "failed",
      error: result.error,
      attemptedAt,
    };
  } catch (err) {
    return {
      operationHash: op.idempotencyKey,
      idempotencyKey: op.idempotencyKey,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      attemptedAt,
    };
  }
}
