import { Hono } from "hono";

export interface AuditDeps {
  getAuditTrail: (jobId: string) => unknown[];
}

export function auditRoutes(deps: AuditDeps) {
  const app = new Hono();
  app.get("/api/audit/:jobId", (c) => {
    return c.json(deps.getAuditTrail(c.req.param("jobId")));
  });
  return app;
}
