import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer, type ServerDeps } from "../api/server.js";
import type { ApprovalStore } from "../publisher/approvals.js";
import type { OrchestratorFacade } from "../orchestrator/facade.js";
import { GuardInputStore } from "../publisher/guard-store.js";
import { PublisherService } from "../publisher/publisher-service.js";

export interface RuntimeConfig {
  port: number;
  schedulerIntervalMs: number;
  attentionIntervalMs: number;
  dataDirectory: string;
  /** When false, skip binding the loopback API server (for unit tests). */
  apiServerEnabled?: boolean;
}

export interface RuntimePublishContext {
  guardStore: GuardInputStore;
  publisher: PublisherService;
  clientDistPath: string;
  publicationMode: "shadow" | "gated";
  configuredOperator: string;
  authenticatedLogin: string;
}

export interface RuntimeHandle {
  port: number;
  url: string;
  facade: OrchestratorFacade;
  stop: () => Promise<void>;
}

export interface RuntimeDeps {
  migrate(): void;
  recoverOrphanedStates(): {
    failedJobs: string[];
    failedRuns: string[];
    failedAdvisorRuns: string[];
    autoRetried: string[];
    failureReasons: Map<string, string>;
    publishingReconciled: string[];
  };
  startDiscoveryPoller(): { stop: () => void };
  runSchedulerTick(): { jobsToStart: string[]; reason: string };
  runAttentionBatch(): void;
  createFacade(): OrchestratorFacade;
  publishContext?: RuntimePublishContext;
}

function defaultClientDistPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../client/dist",
  );
}

function buildServerDeps(
  facade: OrchestratorFacade,
  publishContext: RuntimePublishContext,
  getGuardInput: ServerDeps["getGuardInput"],
): ServerDeps {
  return {
    getHealthStatus: () => {
      const snapshot = facade.getHealthStatus();
      const issues: string[] = [];
      if (snapshot.failedJobsLast24h > 0) {
        issues.push(`${snapshot.failedJobsLast24h} failed jobs in last 24h`);
      }
      if (snapshot.lastPollTimestamp === null) {
        issues.push("Discovery poll has not completed");
      }
      return {
        healthy: issues.length === 0,
        issues,
      };
    },
    getAllTracked: () => facade.getAllTracked(),
    getFocusQueue: () => facade.getFocusQueue(),
    getJob: (id) => facade.getJob(id),
    getDraft: (jobId) => facade.getDraft(jobId),
    getAuditTrail: (jobId) => facade.getAuditTrail(jobId),
    requestAnalyze: (input) => facade.requestAnalyze(input),
    requestRetry: (jobId) => facade.requestRetry(jobId),
    getGuardInput,
    executePublish: (opHash, body) =>
      publishContext.publisher.executeOperation(opHash, body),
    clientDistPath: publishContext.clientDistPath,
  };
}

function createGetGuardInput(
  guardStore: GuardInputStore,
  approvals: ApprovalStore,
): ServerDeps["getGuardInput"] {
  return (operationHash) => {
    const entry = approvals.get(operationHash);
    return guardStore.buildGuardInput(operationHash, entry);
  };
}

export async function startRuntime(
  config: RuntimeConfig,
  deps: RuntimeDeps,
): Promise<RuntimeHandle> {
  deps.migrate();
  deps.recoverOrphanedStates();

  const poller = deps.startDiscoveryPoller();

  let schedulerTimer: ReturnType<typeof setInterval> | null = null;
  let attentionTimer: ReturnType<typeof setInterval> | null = null;

  schedulerTimer = setInterval(() => {
    try {
      deps.runSchedulerTick();
    } catch {
      // scheduler tick errors are logged, not fatal
    }
  }, config.schedulerIntervalMs);

  attentionTimer = setInterval(() => {
    try {
      deps.runAttentionBatch();
    } catch {
      // attention batch errors are logged, not fatal
    }
  }, config.attentionIntervalMs);

  const facade = deps.createFacade();

  const publishContext: RuntimePublishContext = deps.publishContext ?? {
    guardStore: new GuardInputStore(),
    publisher: new PublisherService({
      ghAdapter: async () => ({ ok: false, error: "Publisher not configured" }),
      authenticatedLogin: "",
      configuredOperator: "",
    }),
    clientDistPath: defaultClientDistPath(),
    publicationMode: "shadow",
    configuredOperator: "",
    authenticatedLogin: "",
  };

  let getGuardInput: ServerDeps["getGuardInput"] = () => null;
  const apiServer = createApiServer(
    buildServerDeps(facade, publishContext, (hash) => getGuardInput(hash)),
  );
  getGuardInput = createGetGuardInput(
    publishContext.guardStore,
    apiServer.approvals,
  );

  const PORT = config.port;
  let url = `http://127.0.0.1:${PORT}`;
  let closeApi = () => {};

  if (config.apiServerEnabled !== false) {
    const started = apiServer.start(PORT);
    url = started.url;
    closeApi = started.close;
    console.log(`Control Tower UI: ${url}`);
  }

  async function stop(): Promise<void> {
    closeApi();
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (attentionTimer) {
      clearInterval(attentionTimer);
      attentionTimer = null;
    }
    poller.stop();
  }

  return {
    port: PORT,
    url,
    facade,
    stop,
  };
}

export async function stopRuntime(handle: RuntimeHandle): Promise<void> {
  await handle.stop();
}
