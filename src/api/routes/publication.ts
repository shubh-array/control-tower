import { Hono } from "hono";
import type { ActionTokenStore } from "../action-token.js";
import type { ApprovalStore } from "../../publisher/approvals.js";
import { validatePublishGuards, type GuardInput } from "../../publisher/guards.js";

export interface PublicationDeps {
  actionTokens: ActionTokenStore;
  approvals: ApprovalStore;
  getGuardInput: (operationHash: string) => GuardInput | null;
  executePublish: (
    operationHash: string,
    body: string | null,
  ) => Promise<{ status: "completed" | "failed"; error?: string }>;
}

export function publicationRoutes(deps: PublicationDeps) {
  const app = new Hono();

  app.post("/api/publish", async (c) => {
    const body = await c.req.json<{
      operationHash: string;
      body: string | null;
      actionToken: string;
    }>();

    if (!deps.actionTokens.consume(body.actionToken)) {
      return c.json({ error: "Invalid or expired action token" }, 403);
    }

    const guardInput = deps.getGuardInput(body.operationHash);
    if (!guardInput) {
      return c.json({ error: "Unknown operation" }, 404);
    }

    const guardResult = validatePublishGuards(guardInput);
    if (!guardResult.ok) {
      return c.json({ error: guardResult.reason }, 403);
    }

    if (!deps.approvals.consume(body.operationHash)) {
      return c.json(
        { error: "No valid unconsumed approval for this operation" },
        403,
      );
    }

    const result = await deps.executePublish(body.operationHash, body.body);
    return c.json(result);
  });

  return app;
}
