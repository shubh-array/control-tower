import type { ProfileChangeProposal } from "./types.js";
import type { ProposalStore } from "../api/routes/proposals.js";

export class InMemoryProposalStore implements ProposalStore {
  private proposals = new Map<string, ProfileChangeProposal>();

  get(id: string): ProfileChangeProposal | undefined {
    return this.proposals.get(id);
  }

  save(proposal: ProfileChangeProposal): void {
    this.proposals.set(proposal.id, proposal);
  }

  list(): ProfileChangeProposal[] {
    return [...this.proposals.values()];
  }
}
