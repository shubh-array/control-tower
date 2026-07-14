import { queryKeys } from "./query-keys.js";

export type InvalidatableQueryClient = {
  invalidateQueries: (filters: {
    queryKey: readonly unknown[];
  }) => Promise<void>;
};

export async function invalidateAfterAnalyze(
  queryClient: InvalidatableQueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
    queryClient.invalidateQueries({ queryKey: queryKeys.health }),
  ]);
}

export async function invalidateAfterRetry(
  queryClient: InvalidatableQueryClient,
  jobId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
    queryClient.invalidateQueries({ queryKey: queryKeys.health }),
    queryClient.invalidateQueries({ queryKey: queryKeys.draft(jobId) }),
  ]);
}

export async function invalidateAfterApprove(
  queryClient: InvalidatableQueryClient,
  jobId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
    queryClient.invalidateQueries({ queryKey: queryKeys.draft(jobId) }),
  ]);
}

export async function invalidateAfterPublish(
  queryClient: InvalidatableQueryClient,
  jobId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
    queryClient.invalidateQueries({ queryKey: queryKeys.draft(jobId) }),
  ]);
}
