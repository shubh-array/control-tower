import { Hono } from "hono";
import { validateProposal } from "../../proposals/validate.js";
import { adoptProposal } from "../../proposals/adopt.js";
import { sha256Hex } from "../../util/hash.js";
import type { ProfileChangeProposal } from "../../proposals/types.js";

export interface ProposalStore {
  get(id: string): ProfileChangeProposal | undefined;
  save(proposal: ProfileChangeProposal): void;
  list(): ProfileChangeProposal[];
}

export interface ProposalRoutesDeps {
  store: ProposalStore;
  profileDir: string;
  getCurrentFiles: () => Record<string, { content: string; hash: string }>;
}

export function proposalRoutes(deps: ProposalRoutesDeps) {
  const app = new Hono();

  app.get("/api/proposals", (c) => {
    return c.json(deps.store.list());
  });

  app.get("/api/proposals/:id", (c) => {
    const id = c.req.param("id");
    const proposal = deps.store.get(id);
    if (!proposal) return c.json({ error: "Not found" }, 404);
    return c.json(proposal);
  });

  app.post("/api/proposals/:id/validate", async (c) => {
    const id = c.req.param("id");
    const proposal = deps.store.get(id);
    if (!proposal) return c.json({ error: "Not found" }, 404);

    const currentFiles = deps.getCurrentFiles();
    const result = validateProposal(proposal, currentFiles);
    if (result.valid) {
      proposal.status = "validated";
      deps.store.save(proposal);
    }
    return c.json(result);
  });

  app.post("/api/proposals/:id/adopt", async (c) => {
    const id = c.req.param("id");
    const proposal = deps.store.get(id);
    if (!proposal) return c.json({ error: "Not found" }, 404);
    if (proposal.status !== "previewed") {
      return c.json({ error: "Proposal must be previewed before adoption" }, 400);
    }

    const result = adoptProposal({
      profileDir: deps.profileDir,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      targets: proposal.targets.map((t) => ({
        path: t.path,
        baseContentHash: t.baseContentHash,
        proposedContent: t.proposedContent,
        contentHash: sha256Hex(t.proposedContent),
      })),
    });

    if (result.adopted) {
      proposal.status = "adopted";
      deps.store.save(proposal);
    }
    return c.json(result);
  });

  return app;
}
