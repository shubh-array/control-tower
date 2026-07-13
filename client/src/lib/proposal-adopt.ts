import type { ProposalAdoptionResult } from "./api.js";

export function resolveAdoptControlState(input: {
  isAdopting: boolean;
  adoptionResult: ProposalAdoptionResult | null;
}): { disabled: boolean; label: string } {
  if (input.adoptionResult?.adopted) {
    return { disabled: true, label: "Adopt (single-use)" };
  }
  if (input.isAdopting) {
    return { disabled: true, label: "Adopting…" };
  }
  return { disabled: false, label: "Adopt (single-use)" };
}
