import { Hono } from "hono";
import type { SignalRecorder } from "../../learning/record.js";

export function signalRoutes(recorder: SignalRecorder) {
  const app = new Hono();

  app.get("/api/signals", (c) => {
    const { jobId, runId, role, limit } = c.req.query();

    if (jobId) {
      return c.json(recorder.queryByJobId(jobId));
    }
    if (runId) {
      return c.json(recorder.queryByRunId(runId));
    }
    if (role === "attention" || role === "primaryReview") {
      return c.json(recorder.queryByRole(role));
    }
    return c.json(recorder.queryRecent(parseInt(limit ?? "50", 10)));
  });

  return app;
}
