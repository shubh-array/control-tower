import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer, type ServerDeps } from "../api/server.js";
import type { ApprovalStore } from "../publisher/approvals.js";
import type { OrchestratorFacade } from "../orchestrator/facade.js";
import { GuardInputStore } from "../publisher/guard-store.js";
import { PublisherService } from "../publisher/publisher-service.js";
import type { FocusQueueRow, TrackedQueueRow } from "../api/contracts.js";
import type { AllTrackedItem } from "../policy/evaluate.js";
import { toQueueTuple } from "../policy/queue-order.js";
import type { SignalRecorder } from "../learning/record.js";
import type { ProposalStore } from "../api/routes/proposals.js";
import type { ProfileChangeProposal } from "../proposals/types.js";
import Database from "better-sqlite3";
import { SignalRecorder as SignalRecorderImpl } from "../learning/record.js";
import { FilesystemProposalStore } from "../proposals/store.js";

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
  getAllTrackedRows: () => TrackedQueueRow[];
  getFocusQueueRows: () => {
    now: FocusQueueRow[];
    next: FocusQueueRow[];
    monitor: FocusQueueRow[];
  };
  getJobDetail: (id: string) => import("../api/contracts.js").JobDetail | null;
  getDraftDetail: (jobId: string) => import("../api/contracts.js").DraftDetail | null;
  signalRecorder: SignalRecorder;
  proposalStore: ProposalStore;
  profileDirectory: string;
  dataDirectory: string;
  getProfileFiles: () => Record<string, { content: string; hash: string }>;
  startProposal: (signalRunIds: string[]) => Promise<ProfileChangeProposal>;
  recordPublishedDisposition?: (operationHash: string) => void;
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

function stubQueueOrder(item: AllTrackedItem): TrackedQueueRow["queueOrder"] {
  const { queueTimestampSort, ...tupleRest } = toQueueTuple({
    prNumber: item.prNumber,
    normalizedRepositoryIdentity: item.repositoryKey,
    prioritySortOrdinal: item.policy.prioritySortOrdinal,
    explicitRequest: item.reviewRequested,
    explicitRequestTimestamp: item.explicitRequestTimestamp ?? undefined,
    updatedAt: item.updatedAt ?? "unknown",
    eligible: item.policy.eligible,
  });
  return {
    ...tupleRest,
    queueTimestamp: queueTimestampSort,
  };
}

function stubTrackedQueueRow(item: AllTrackedItem): TrackedQueueRow {
  return {
    jobId: null,
    repositoryKey: item.repositoryKey,
    repository: item.repositoryKey,
    prNumber: item.prNumber,
    title: item.title,
    url: item.url,
    author: item.author,
    headSha: item.headSha,
    eligibilityReasons: item.policy.eligibilityReasons as unknown as TrackedQueueRow["eligibilityReasons"],
    exclusionReasons: item.policy.exclusionReasons as unknown as TrackedQueueRow["exclusionReasons"],
    priority: item.policy.priorityStatus,
    priorityReasons: item.policy.priorityReasons as unknown as TrackedQueueRow["priorityReasons"],
    queueOrder: stubQueueOrder(item),
    domains: item.policy.selectedDomains.map((d) => d.domain),
    attentionState: "monitoring",
    jobState: null,
    advisorResult: null,
    discoveredAt: item.updatedAt ?? new Date().toISOString(),
    updatedAt: item.updatedAt ?? new Date().toISOString(),
  };
}

function createStubLearningDeps(): {
  signalRecorder: SignalRecorder;
  proposalStore: ProposalStore;
  profileDirectory: string;
  dataDirectory: string;
  getProfileFiles: () => Record<string, { content: string; hash: string }>;
  startProposal: (signalRunIds: string[]) => Promise<ProfileChangeProposal>;
} {
  const db = new Database(":memory:");
  const signalRecorder = new SignalRecorderImpl(db);
  signalRecorder.initialize();
  const proposalStore = new FilesystemProposalStore("/tmp/ct-stub-data");

  return {
    signalRecorder,
    proposalStore,
    profileDirectory: "/tmp/ct-stub-profile",
    dataDirectory: "/tmp/ct-stub-data",
    getProfileFiles: () => ({}),
    startProposal: async () => {
      throw new Error("Proposal orchestration not configured");
    },
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
    getAllTracked: () => publishContext.getAllTrackedRows(),
    getFocusQueue: () => publishContext.getFocusQueueRows(),
    getJob: (id) => publishContext.getJobDetail(id),
    getDraft: (jobId) => publishContext.getDraftDetail(jobId),
    getAuditTrail: (jobId) => facade.getAuditTrail(jobId),
    requestAnalyze: (input) => facade.requestAnalyze(input),
    requestRetry: (jobId) => facade.requestRetry(jobId),
    getGuardInput,
    executePublish: async (opHash, body) => {
      const result = await publishContext.publisher.executeOperation(opHash, body);
      if (result.status === "completed") {
        publishContext.recordPublishedDisposition?.(opHash);
      }
      return result;
    },
    clientDistPath: publishContext.clientDistPath,
    signalRecorder: publishContext.signalRecorder,
    proposalRoutes: {
      store: publishContext.proposalStore,
      profileDir: publishContext.profileDirectory,
      dataDirectory: publishContext.dataDirectory,
      getCurrentFiles: publishContext.getProfileFiles,
      startProposal: publishContext.startProposal,
    },
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
  const stubLearning = createStubLearningDeps();

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
    ...stubLearning,
    getAllTrackedRows: () => facade.getAllTracked().map(stubTrackedQueueRow),
    getFocusQueueRows: () => {
      const q = facade.getFocusQueue();
      const map = (items: typeof q.now) => items.map(stubTrackedQueueRow);
      return { now: map(q.now), next: map(q.next), monitor: map(q.monitor) };
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
