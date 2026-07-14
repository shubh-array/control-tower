import { Hono } from "hono";
import type { FocusQueueResponse } from "../contracts.js";

export interface QueueDeps {
  getFocusQueue: () => FocusQueueResponse;
}

export function queueRoutes(deps: QueueDeps) {
  const app = new Hono();
  app.get("/api/queue", (c) => {
    const queue = deps.getFocusQueue();
    return c.json({
      focusQueue: {
        now: queue.now,
        next: queue.next,
        monitor: queue.monitor,
      },
      summary: queue.summary,
    });
  });
  return app;
}
