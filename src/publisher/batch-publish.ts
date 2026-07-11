import type { ExternalOperation } from "./operation-hash.js";

export interface OperationEntry {
  operation: ExternalOperation;
  body: string | null;
}

export interface CompletionEntry {
  status: "completed" | "failed";
  githubId?: string;
  error?: string;
}

export type CompletionMap = Record<string, CompletionEntry>;

export interface BatchPublishResult {
  completionMap: CompletionMap;
  allComplete: boolean;
  failedOperations: string[];
}

export interface BatchPublishDeps {
  executeOne: (
    op: ExternalOperation,
    body: string | null,
  ) => Promise<{ status: "completed" | "failed"; githubId?: string; error?: string }>;
}

export async function executeBatchPublish(
  deps: BatchPublishDeps,
  operations: OperationEntry[],
): Promise<BatchPublishResult> {
  const completionMap: CompletionMap = {};
  const failedOperations: string[] = [];

  for (const entry of operations) {
    const key = entry.operation.idempotencyKey;
    try {
      const result = await deps.executeOne(entry.operation, entry.body);
      completionMap[key] = {
        status: result.status,
        githubId: result.githubId,
        error: result.error,
      };
      if (result.status === "failed") {
        failedOperations.push(key);
      }
    } catch (err) {
      completionMap[key] = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
      failedOperations.push(key);
    }
  }

  return {
    completionMap,
    allComplete: failedOperations.length === 0,
    failedOperations,
  };
}

export function getIncompleteOperations(
  completionMap: CompletionMap,
  allOps: OperationEntry[],
): OperationEntry[] {
  return allOps.filter(
    (entry) =>
      completionMap[entry.operation.idempotencyKey]?.status !== "completed",
  );
}
