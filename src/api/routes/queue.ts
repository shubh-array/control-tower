import { Hono } from "hono";
import type { FocusQueueRow } from "../contracts.js";

export interface QueueDeps {
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
      focusQueue: deps.getFocusQueue(),
    });
  });
  return app;
}
