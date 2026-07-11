import { Hono } from "hono";

export interface QueueDeps {
  getAllTracked: () => unknown[];
  getFocusQueue: () => { now: unknown[]; next: unknown[]; monitor: unknown[] };
}

export function queueRoutes(deps: QueueDeps) {
  const app = new Hono();
  app.get("/api/queue", (c) => {
    return c.json({
      allTracked: deps.getAllTracked(),
      focusQueue: deps.getFocusQueue(),
    });
  });
  return app;
}
