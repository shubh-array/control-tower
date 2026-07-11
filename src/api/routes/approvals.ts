import { Hono } from "hono";
import type { ActionTokenStore } from "../action-token.js";
import type { ApprovalStore } from "../../publisher/approvals.js";

export interface ApprovalsDeps {
  actionTokens: ActionTokenStore;
  approvals: ApprovalStore;
  sessionSecret: string;
}

export function approvalsRoutes(deps: ApprovalsDeps) {
  const app = new Hono();

  app.post("/api/approvals", async (c) => {
    const body = await c.req.json<{
      operationHash: string;
      actionToken: string;
    }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    deps.approvals.create(body.operationHash);
    return c.json({ approved: true });
  });

  return app;
}
