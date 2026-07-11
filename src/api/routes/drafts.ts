import { Hono } from "hono";
import type { DraftDetail } from "../contracts.js";

export interface DraftsDeps {
  getDraft: (jobId: string) => DraftDetail | null;
}

export function draftsRoutes(deps: DraftsDeps) {
  const app = new Hono();
  app.get("/api/drafts/:jobId", (c) => {
    const draft = deps.getDraft(c.req.param("jobId"));
    if (!draft) return c.json({ error: "Draft not found" }, 404);
    return c.json(draft);
  });
  return app;
}
