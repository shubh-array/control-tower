import { Hono } from "hono";
import type { ActionTokenStore } from "../action-token.js";
import type { JobDetail } from "../contracts.js";

export interface JobsDeps {
  actionTokens: ActionTokenStore;
  getJob: (id: string) => JobDetail | null;
  requestAnalyze: (input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: "registered-source" | "remote-evidence-only";
  }) => string;
  requestRetry: (jobId: string) => string;
}

export function jobsRoutes(deps: JobsDeps) {
  const app = new Hono();
  app.get("/api/jobs/:id", (c) => {
    const job = deps.getJob(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  });

  app.post("/api/jobs/analyze", async (c) => {
    const body = await c.req.json<{
      repositoryKey: string;
      prNumber: number;
      sourceMode?: "registered-source" | "remote-evidence-only";
      actionToken: string;
    }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    const jobId = deps.requestAnalyze(body);
    return c.json({ jobId });
  });

  app.post("/api/jobs/:id/retry", async (c) => {
    const body = await c.req.json<{ actionToken: string }>();
    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }
    const newRunId = deps.requestRetry(c.req.param("id"));
    return c.json({ runId: newRunId });
  });

  return app;
}
