import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

export class FilesystemProposalStore implements ProposalStore {
  private readonly proposalsDir: string;

  constructor(dataDirectory: string) {
    this.proposalsDir = join(dataDirectory, "proposals");
    mkdirSync(this.proposalsDir, { recursive: true });
  }

  private proposalPath(id: string): string {
    return join(this.proposalsDir, `${id}.json`);
  }

  get(id: string): ProfileChangeProposal | undefined {
    const path = this.proposalPath(id);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ProfileChangeProposal;
    } catch {
      return undefined;
    }
  }

  save(proposal: ProfileChangeProposal): void {
    writeFileSync(
      this.proposalPath(proposal.id),
      JSON.stringify(proposal, null, 2),
      "utf-8",
    );
  }

  list(): ProfileChangeProposal[] {
    if (!existsSync(this.proposalsDir)) return [];
    return readdirSync(this.proposalsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          return JSON.parse(
            readFileSync(join(this.proposalsDir, name), "utf-8"),
          ) as ProfileChangeProposal;
        } catch {
          return null;
        }
      })
      .filter((p): p is ProfileChangeProposal => p !== null);
  }
}
