import { Hono } from "hono";

export interface JobsDeps {
  getJob: (id: string) => unknown | null;
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
    }>();
    const jobId = deps.requestAnalyze(body);
    return c.json({ jobId });
  });

  app.post("/api/jobs/:id/retry", (c) => {
    const newRunId = deps.requestRetry(c.req.param("id"));
    return c.json({ runId: newRunId });
  });

  return app;
}
