import { Hono } from "hono";
import type { ActionTokenStore } from "../action-token.js";
import { validateProposal } from "../../proposals/validate.js";
import { adoptProposal } from "../../proposals/adopt.js";
import { generatePreview, type ProposalPreview } from "../../proposals/preview.js";
import { sha256Hex } from "../../util/hash.js";
import type { ProfileChangeProposal } from "../../proposals/types.js";

export interface ProposalStore {
  get(id: string): ProfileChangeProposal | undefined;
  save(proposal: ProfileChangeProposal): void;
  list(): ProfileChangeProposal[];
}

export interface ProposalRoutesDeps {
  actionTokens: ActionTokenStore;
  store: ProposalStore;
  profileDir: string;
  dataDirectory: string;
  getCurrentFiles: () => Record<string, { content: string; hash: string }>;
  startProposal: (signalRunIds: string[]) => Promise<ProfileChangeProposal>;
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

  app.post("/api/proposals/start", async (c) => {
    const body = await c.req.json<{
      signalRunIds: string[];
      actionToken: string;
    }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    try {
      const proposal = await deps.startProposal(body.signalRunIds ?? []);
      deps.store.save(proposal);
      return c.json(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.post("/api/proposals/:id/validate", async (c) => {
    const body = await c.req.json<{ actionToken: string }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    const id = c.req.param("id");
    const proposal = deps.store.get(id);
    if (!proposal) return c.json({ error: "Not found" }, 404);

    const currentFiles = deps.getCurrentFiles();
    const result = validateProposal(proposal, currentFiles);
    const previews: ProposalPreview[] = proposal.targets.map((target) => {
      const current = currentFiles[target.path];
      return generatePreview(
        proposal.id,
        target.path,
        current?.content ?? "",
        target.proposedContent,
      );
    });
    if (result.valid) {
      proposal.status = "previewed";
      deps.store.save(proposal);
    }
    return c.json({ ...result, previews });
  });

  app.post("/api/proposals/:id/adopt", async (c) => {
    const body = await c.req.json<{ actionToken: string }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    const id = c.req.param("id");
    const proposal = deps.store.get(id);
    if (!proposal) return c.json({ error: "Not found" }, 404);
    if (proposal.status !== "previewed") {
      return c.json({ error: "Proposal must be previewed before adoption" }, 400);
    }

    const result = adoptProposal({
      profileDir: deps.profileDir,
      dataDirectory: deps.dataDirectory,
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
