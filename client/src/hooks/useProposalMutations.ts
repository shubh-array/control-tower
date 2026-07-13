import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import {
  invalidateAfterAdoptProposal,
  invalidateAfterStartProposal,
  invalidateAfterValidateProposal,
} from "../lib/query-invalidation.js";

const DEFAULT_SIGNAL_LIMIT = 50;

export function useStartProposalMutation(signalLimit = DEFAULT_SIGNAL_LIMIT) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (signalRunIds: string[]) => api.startProposal(signalRunIds),
    onSuccess: async () => {
      await invalidateAfterStartProposal(queryClient, signalLimit);
    },
  });
}

export function useValidateProposalMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (proposalId: string) => api.validateProposal(proposalId),
    onSuccess: async () => {
      await invalidateAfterValidateProposal(queryClient);
    },
  });
}

export function useAdoptProposalMutation(signalLimit = DEFAULT_SIGNAL_LIMIT) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (proposalId: string) => api.adoptProposal(proposalId),
    onSuccess: async () => {
      await invalidateAfterAdoptProposal(queryClient, signalLimit);
    },
  });
}
