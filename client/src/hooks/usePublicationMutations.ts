import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import {
  invalidateAfterApprove,
  invalidateAfterPublish,
} from "../lib/query-invalidation.js";

export function useApproveMutation(jobId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (operationHash: string) => api.approveOperation(operationHash),
    onSuccess: async () => {
      if (jobId !== null) {
        await invalidateAfterApprove(queryClient, jobId);
      }
    },
  });
}

export function usePublishMutation(jobId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { operationHash: string; body: string | null }) =>
      api.publishOperation(input.operationHash, input.body),
    onSuccess: async () => {
      if (jobId !== null) {
        await invalidateAfterPublish(queryClient, jobId);
      }
    },
  });
}
