import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { loopbackGuard, cspMiddleware } from "./csp.js";
import { createSessionSecret, createSessionCookie, validateSession } from "./session.js";
import { ActionTokenStore } from "./action-token.js";
import { healthRoutes, type HealthDeps } from "./routes/health.js";
import { queueRoutes, type QueueDeps } from "./routes/queue.js";
import { jobsRoutes, type JobsDeps } from "./routes/jobs.js";
import { draftsRoutes, type DraftsDeps } from "./routes/drafts.js";
import { approvalsRoutes } from "./routes/approvals.js";
import { publicationRoutes, type PublicationDeps } from "./routes/publication.js";
import { auditRoutes, type AuditDeps } from "./routes/audit.js";
import { signalRoutes } from "./routes/signals.js";
import { proposalRoutes, type ProposalRoutesDeps } from "./routes/proposals.js";
import { ApprovalStore } from "../publisher/approvals.js";
import type { SignalRecorder } from "../learning/record.js";

export interface ServerDeps extends HealthDeps, QueueDeps, DraftsDeps, AuditDeps {
  getJob: JobsDeps["getJob"];
  requestAnalyze: JobsDeps["requestAnalyze"];
  requestRetry: JobsDeps["requestRetry"];
  getGuardInput: PublicationDeps["getGuardInput"];
  executePublish: PublicationDeps["executePublish"];
  clientDistPath: string;
  signalRecorder: SignalRecorder;
  proposalRoutes: Omit<ProposalRoutesDeps, "actionTokens">;
}

export function createApiServer(deps: ServerDeps) {
  const app = new Hono();
  const sessionSecret = createSessionSecret();
  const actionTokens = new ActionTokenStore();
  const approvals = new ApprovalStore();

  app.use("*", loopbackGuard);
  app.use("*", cspMiddleware);

  const issueSession = (c: { header: (name: string, value: string) => void }) => {
    c.header("set-cookie", createSessionCookie(sessionSecret));
  };

  app.get("/", (c) => {
    issueSession(c);
    return c.redirect("/index.html");
  });

  app.use("/api/*", async (c, next) => {
    const cookie = c.req.header("cookie");
    const origin = c.req.header("origin");
    if (!validateSession(sessionSecret, cookie, origin)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.post("/api/action-token", (c) => {
    const token = actionTokens.create();
    return c.json({ token });
  });

  app.route("/", healthRoutes(deps));
  app.route("/", queueRoutes(deps));
  app.route(
    "/",
    jobsRoutes({
      actionTokens,
      getJob: deps.getJob,
      requestAnalyze: deps.requestAnalyze,
      requestRetry: deps.requestRetry,
    }),
  );
  app.route("/", draftsRoutes(deps));
  app.route(
    "/",
    approvalsRoutes({ actionTokens, approvals, sessionSecret }),
  );
  app.route(
    "/",
    publicationRoutes({
      actionTokens,
      approvals,
      getGuardInput: deps.getGuardInput,
      executePublish: deps.executePublish,
    }),
  );
  app.route("/", auditRoutes(deps));
  app.route("/", signalRoutes(deps.signalRecorder));
  app.route(
    "/",
    proposalRoutes({
      actionTokens,
      ...deps.proposalRoutes,
    }),
  );

  app.use("/*", async (c, next) => {
    const cookie = c.req.header("cookie");
    if (!cookie?.includes("ct_session=")) {
      issueSession(c);
    }
    await next();
  });

  app.use("/*", serveStatic({ root: deps.clientDistPath }));

  const cleanupInterval = setInterval(() => actionTokens.cleanup(), 60_000);

  return {
    app,
    approvals,
    start(port: number) {
      const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
      return {
        url: `http://127.0.0.1:${port}`,
        close() {
          clearInterval(cleanupInterval);
          approvals.invalidateAll();
          server.close();
        },
      };
    },
  };
}
