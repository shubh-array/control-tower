import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer, type ServerDeps } from "../api/server.js";
import type { ApprovalStore } from "../publisher/approvals.js";
import type { OrchestratorFacade } from "../orchestrator/facade.js";
import { GuardInputStore } from "../publisher/guard-store.js";
import { PublisherService } from "../publisher/publisher-service.js";
import type { FocusQueueResponse, ReviewQueueRow } from "../api/contracts.js";
import { projectInboxSummary } from "../api/projections/inbox-summary.js";
import type { ReviewQueueItem } from "../policy/evaluate.js";
import { toQueueTuple } from "../policy/queue-order.js";

export interface RuntimeConfig {
  port: number;
  schedulerIntervalMs: number;
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
  getFocusQueueRows: () => FocusQueueResponse;
  getJobDetail: (id: string) => import("../api/contracts.js").JobDetail | null;
  getDraftDetail: (jobId: string) => import("../api/contracts.js").DraftDetail | null;
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
    autoRetried: string[];
    failureReasons: Map<string, string>;
    publishingReconciled: string[];
  };
  startDiscoveryPoller(): { stop: () => void };
  runSchedulerTick(): { jobsToStart: string[]; reason: string };
  createFacade(): OrchestratorFacade;
  publishContext?: RuntimePublishContext;
}

function defaultClientDistPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../client/dist",
  );
}

function stubQueueOrder(item: ReviewQueueItem): ReviewQueueRow["queueOrder"] {
  const { queueTimestampSort, ...tupleRest } = toQueueTuple({
    prNumber: item.prNumber,
    normalizedRepositoryIdentity: item.repositoryKey,
    prioritySortOrdinal: item.policy.prioritySortOrdinal,
    explicitRequest: item.explicitRequest,
    explicitRequestTimestamp: item.explicitRequestTimestamp ?? undefined,
    updatedAt: item.updatedAt || "unknown",
    eligible: item.policy.eligible,
  });
  return {
    ...tupleRest,
    queueTimestamp: queueTimestampSort,
  };
}

function stubReviewQueueRow(item: ReviewQueueItem): ReviewQueueRow {
  return {
    jobId: null,
    repositoryKey: item.repositoryKey,
    repository: item.repositoryKey,
    prNumber: item.prNumber,
    title: item.title,
    url: item.url,
    author: item.author,
    headSha: item.headSha,
    explicitRequest: item.explicitRequest,
    eligibilityReasons: item.policy.eligibilityReasons as unknown as ReviewQueueRow["eligibilityReasons"],
    priority: item.policy.priorityStatus as ReviewQueueRow["priority"],
    priorityReasons: item.policy.priorityReasons as unknown as ReviewQueueRow["priorityReasons"],
    queueOrder: stubQueueOrder(item),
    domains: item.policy.selectedDomains.map((d) => d.domain),
    jobState: null,
    stale: false,
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
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
    getFocusQueue: () => publishContext.getFocusQueueRows(),
    getJob: (id) => publishContext.getJobDetail(id),
    getDraft: (jobId) => publishContext.getDraftDetail(jobId),
    getAuditTrail: (jobId) => facade.getAuditTrail(jobId),
    requestAnalyze: (input) => facade.requestAnalyze(input),
    requestRetry: (jobId) => facade.requestRetry(jobId),
    getGuardInput,
    executePublish: async (opHash, body) =>
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

  schedulerTimer = setInterval(() => {
    try {
      deps.runSchedulerTick();
    } catch {
      // scheduler tick errors are logged, not fatal
    }
  }, config.schedulerIntervalMs);

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
    getFocusQueueRows: () => {
      const q = facade.getFocusQueue();
      const map = (items: typeof q.now) => items.map(stubReviewQueueRow);
      const now = map(q.now);
      const next = map(q.next);
      const monitor = map(q.monitor);
      return {
        now,
        next,
        monitor,
        summary: projectInboxSummary(
          [...now, ...next, ...monitor],
          facade.getHealthStatus().lastPollTimestamp,
        ),
      };
    },
    getJobDetail: (id) => {
      const job = facade.getJob(id);
      if (!job) return null;
      return {
        jobId: job.jobId,
        repository: job.repository,
        prNumber: job.prNumber,
        headSha: job.headSha,
        state: job.state,
        sourceMode: job.sourceMode,
        runs: job.runs,
        acceptedRunId: job.acceptedRunId,
      };
    },
    getDraftDetail: (jobId) => facade.getDraft(jobId),
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
