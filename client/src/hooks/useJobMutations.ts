import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import {
  invalidateAfterAnalyze,
  invalidateAfterRetry,
} from "../lib/query-invalidation.js";

export function useAnalyzeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      repositoryKey: string;
      prNumber: number;
      sourceMode?: "registered-source" | "remote-evidence-only";
    }) => api.requestAnalyze(input),
    onSuccess: async () => {
      await invalidateAfterAnalyze(queryClient);
    },
  });
}

export function useRetryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.requestRetry(jobId),
    onSuccess: async (_result, jobId) => {
      await invalidateAfterRetry(queryClient, jobId);
    },
  });
}
