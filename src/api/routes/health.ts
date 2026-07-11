import { Hono } from "hono";

export interface HealthDeps {
  getHealthStatus: () => { healthy: boolean; issues: string[] };
}

export function healthRoutes(deps: HealthDeps) {
  const app = new Hono();
  app.get("/api/health", (c) => {
    return c.json(deps.getHealthStatus());
  });
  return app;
}
