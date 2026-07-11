import { Hono } from "hono";
import type { FocusQueueRow, TrackedQueueRow } from "../contracts.js";

export interface QueueDeps {
  getAllTracked: () => TrackedQueueRow[];
  getFocusQueue: () => {
    now: FocusQueueRow[];
    next: FocusQueueRow[];
    monitor: FocusQueueRow[];
  };
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
