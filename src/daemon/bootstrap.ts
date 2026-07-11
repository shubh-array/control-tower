import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { openDatabase } from "../store/db.js";
import { runMigrations } from "../store/migrate.js";
import {
  loadLocalConfig,
  loadOrganizationConfig,
  loadProfileConfig,
  loadPolicyConfig,
} from "../config/load.js";
import { normalizeLogin } from "../config/author-login.js";
import type { LocalConfig, OrganizationConfig, PolicyConfig, ProfileConfig } from "../config/types.js";
import { evaluatePolicy } from "../policy/evaluate.js";
import { computePolicyDecisionHash } from "../orchestrator/job-identity.js";
import { computeJobIdentity } from "../orchestrator/job-identity.js";
import { enqueueFromPolicyDecision } from "../orchestrator/enqueue.js";
import { createOrchestratorFacade, type FacadeDeps } from "../orchestrator/facade.js";
import { WorkGraph } from "../orchestrator/work-graph.js";
import { recoverOrphanedStates } from "../orchestrator/recovery.js";
import { selectNextJobs } from "../orchestrator/scheduler.js";
import { ResilientPoller } from "../discovery/poll-resilience.js";
import { CheckpointStore } from "../discovery/checkpoints.js";
import { GitHubAdapter } from "../github/adapter.js";
import { execGhJson, execGhText } from "../github/gh-process.js";
import { verifyOperatorIdentity } from "../github/operator-identity.js";
import { RateLimitTracker } from "../github/rate-limit.js";
import {
  createPersistDecision,
  upsertDiscoveredPr,
  upsertRepository,
} from "../normalize/upsert.js";
import type { DiscoveredPr } from "../github/types.js";
import { GuardInputStore } from "../publisher/guard-store.js";
import { PublisherService } from "../publisher/publisher-service.js";
import { createGhPublishAdapter } from "../github/gh-publish-adapter.js";
import { registerDraftOperations } from "../publisher/register-draft.js";
import { loadDraftBundle } from "../orchestrator/draft-loader.js";
import { loadJobDetail } from "../api/projections/job.js";
import {
  projectAllTracked,
  projectFocusQueue,
} from "../api/projections/queue.js";
import { createRetryAttempt } from "../orchestrator/retry.js";
import { runPipelineForJob } from "../orchestrator/pipeline-runner.js";
import type { RuntimeDeps, RuntimeConfig } from "./runtime.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { SignalRecorder } from "../learning/record.js";
import { FilesystemProposalStore } from "../proposals/store.js";
import { sha256Hex } from "../util/hash.js";
import {
  createAttentionSignalHooks,
  createPrimaryReviewSignalHooks,
  mapAdvisorToAttentionOutcome,
  mapOperationTypeToDisposition,
} from "../learning/pipeline-signals.js";
import { startProposalFromSignals } from "../proposals/start.js";
import {
  defaultProposalEvaluator,
  loadCorpusCases,
  loadProfileFiles,
} from "../proposals/profile-files.js";
import type { CursorRunAdapter } from "../proposals/run.js";

const MATCHER_VERSION = 1;
const startTime = Date.now();

export interface BootstrapContext {
  db: Database.Database;
  guardStore: GuardInputStore;
  publisher: PublisherService;
  publicationMode: "shadow" | "gated";
  configuredOperator: string;
  authenticatedLogin: string;
  clientDistPath: string;
  signalRecorder: SignalRecorder;
  proposalStore: FilesystemProposalStore;
  profileDirectory: string;
  dataDirectory: string;
  appRoot: string;
}

export interface BootstrapInput {
  appRoot: string;
  localConfigPath: string;
}

function resolveRepositoryKey(
  org: OrganizationConfig,
  pr: DiscoveredPr,
): string {
  const catalog = org.repositories.find((r) => r.id === pr.repositoryId);
  if (catalog) return catalog.id;
  return `github:${org.github.host}/${pr.githubOwnerRepo}`;
}

function resolveSourceMode(
  local: LocalConfig,
  pr: DiscoveredPr,
): "registered-source" | "remote-evidence-only" {
  const path = local.repositoryPaths[pr.repositoryId];
  return path && existsSync(path) ? "registered-source" : "remote-evidence-only";
}

function buildEnqueueDeps(db: Database.Database) {
  return {
    findActiveJobByIdentity(identityHash: string) {
      return (
        (db
          .prepare(
            `SELECT id, head_sha, policy_hash, source_mode, state, version
             FROM jobs WHERE identity_hash = ? AND state NOT IN ('superseded', 'cancelled', 'published')`,
          )
          .get(identityHash) as {
          id: string;
          head_sha: string;
          policy_hash: string;
          source_mode: string;
          state: string;
          version: number;
        } | undefined) ?? null
      );
    },
    insertJob(row: Record<string, unknown>): string {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO jobs (
          id, identity_hash, repository_id, repository_key, pr_number,
          head_sha, source_mode, policy_hash, state, version,
          priority_sort_ordinal, explicit_request_sort, queue_timestamp, queued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      ).run(
        id,
        row.identityHash,
        row.repositoryId ?? null,
        row.repositoryKey,
        row.prNumber,
        row.headSha,
        row.sourceMode,
        row.policyHash,
        row.prioritySortOrdinal ?? 3,
        row.explicitRequest ? 0 : 1,
        row.explicitRequest ? new Date().toISOString() : null,
      );
      return id;
    },
    supersede(jobId: string, version: number): void {
      db.prepare(
        `UPDATE jobs SET state = 'superseded', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND version = ?`,
      ).run(jobId, version);
    },
    computeIdentityHash(input: Record<string, unknown>) {
      return computeJobIdentity({
        role: "primaryReview",
        repositoryKey: input.repositoryKey as string,
        prNumber: input.prNumber as number,
        headSha: input.headSha as string,
        sourceMode: input.sourceMode as "registered-source" | "remote-evidence-only",
        policyDecisionHash: input.policyDecisionHash as string,
      });
    },
    computePolicyHash(decision: Parameters<typeof computePolicyDecisionHash>[0]["decision"]) {
      return computePolicyDecisionHash({
        matcherVersion: MATCHER_VERSION,
        decision,
        reviewRelevantPolicySubset: {},
      });
    },
  };
}

function buildFacadeDeps(
  db: Database.Database,
  workGraph: WorkGraph,
  enqueueDeps: ReturnType<typeof buildEnqueueDeps>,
  policy: PolicyConfig,
  profile: ProfileConfig,
  org: OrganizationConfig,
  _local: LocalConfig,
  context: BootstrapContext,
  dataDirectory: string,
): FacadeDeps {
  const enqueuedJobs: Array<{ repositoryKey: string; prNumber: number }> = [];
  const draftCtx = {
    dataDirectory,
    principalLogin: context.configuredOperator,
  };

  const registerOpsFromBundle = (bundle: NonNullable<ReturnType<typeof loadDraftBundle>>) => {
    if (bundle.operations.length === 0) return;
    registerDraftOperations(
      context.guardStore,
      context.publisher,
      bundle.operations,
      {
        publicationMode: context.publicationMode,
        authenticatedLogin: context.authenticatedLogin,
        configuredOperator: context.configuredOperator,
        currentHeadSha: bundle.headSha,
        reviewedHeadSha: bundle.headSha,
        acceptedRunId: bundle.acceptedRunId,
        approvedRunInputHash: bundle.runInputHash,
      },
    );
  };

  return {
    getAllTracked: () => workGraph.getAllTracked(),
    getFocusQueue: () => workGraph.getFocusQueue(),
    getJob: (id: string) => loadJobDetail(db, id),
    getDraft: (jobId: string) => {
      const bundle = loadDraftBundle(db, jobId, draftCtx);
      if (!bundle) return null;
      registerOpsFromBundle(bundle);
      return bundle.detail;
    },
    getAuditTrail: (jobId: string) => {
      const rows = db
        .prepare(
          `SELECT event, created_at as timestamp FROM audit_events
           WHERE entity_id = ? ORDER BY created_at`,
        )
        .all(jobId) as Array<{ event: string; timestamp: string }>;
      return rows.map((r) => ({
        jobId,
        event: r.event,
        timestamp: r.timestamp,
      }));
    },
    enqueueAnalysis: (input) => {
      enqueuedJobs.push({
        repositoryKey: input.repositoryKey,
        prNumber: input.prNumber,
      });
      const prRow = db
        .prepare(
          `SELECT p.head_sha, p.repository_id
           FROM prs p
           JOIN attention_items ai ON ai.repository_key = ? AND ai.pr_number = ?
           WHERE p.repository_id = ai.repository_id AND p.pr_number = ai.pr_number`,
        )
        .get(input.repositoryKey, input.prNumber) as
        | { head_sha: string; repository_id: string }
        | undefined;

      const headSha = prRow?.head_sha ?? "0".repeat(40);
      const sourceMode =
        (input.sourceMode as "registered-source" | "remote-evidence-only" | undefined) ??
        "registered-source";
      const repoPolicy = policy.repositories[input.repositoryKey] ?? null;
      const stubPr: DiscoveredPr = {
        repositoryId: prRow?.repository_id ?? input.repositoryKey,
        githubOwnerRepo: input.repositoryKey,
        prNumber: input.prNumber,
        title: "",
        url: "",
        state: "OPEN",
        isDraft: false,
        authorLogin: profile.githubLogin,
        headSha,
        baseSha: headSha,
        labels: [],
        additions: 0,
        deletions: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changedFiles: [],
        unsafeFiles: [],
        reviewRequests: [],
        checks: [],
        reviews: [],
        comments: [],
        explicitRequest: true,
        explicitRequestTimestamp: new Date().toISOString(),
      };

      const decision = evaluatePolicy({
        pr: stubPr,
        activeRepositoryIds: profile.activeRepositoryIds,
        repositoryPolicy: repoPolicy,
        autoAnalyzeConfig: policy.autoAnalyze,
        operatorLogin: profile.githubLogin,
      });

      const result = enqueueFromPolicyDecision(enqueueDeps, {
        repositoryKey: input.repositoryKey,
        prNumber: input.prNumber,
        headSha,
        sourceMode,
        policy: { ...decision, analysisMode: "on_demand" },
        normalizedRepositoryIdentity: input.repositoryKey,
        explicitRequest: true,
      });

      return result.jobId ?? randomUUID();
    },
    enqueueRetry: (jobId: string) => createRetryAttempt(db, jobId),
    scheduleAdvice: (repositoryKey, prNumber) => {
      const att = db
        .prepare(
          `SELECT id, advisor_relevance, advisor_risk, advisor_recommended_action
           FROM attention_items
           WHERE repository_key = ? AND pr_number = ?`,
        )
        .get(repositoryKey, prNumber) as
        | {
            id: string;
            advisor_relevance: string | null;
            advisor_risk: string | null;
            advisor_recommended_action: string | null;
          }
        | undefined;
      if (!att) return;

      const attentionModelSpec =
        _local.cursor.modelRoles.attention?.modelId ?? "attention-default";
      const hooks = createAttentionSignalHooks(
        db,
        context.signalRecorder,
        repositoryKey,
        prNumber,
        att.id,
        sha256Hex(attentionModelSpec),
      );
      hooks.onAttentionOutcome(
        mapAdvisorToAttentionOutcome({
          advisorRelevance: att.advisor_relevance,
          advisorRisk: att.advisor_risk,
          advisorRecommendedAction: att.advisor_recommended_action,
        }),
      );
    },
    getHealthStatus: () => {
      const activeJobs =
        (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM jobs WHERE state IN (
                'preparing_context','preparing_source','running_agent','validating_output','publishing'
              )`,
            )
            .get() as { cnt: number }
        ).cnt ?? 0;
      const queuedJobs =
        (
          db.prepare(`SELECT COUNT(*) as cnt FROM jobs WHERE state = 'queued'`).get() as {
            cnt: number;
          }
        ).cnt ?? 0;
      const failedJobsLast24h =
        (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM jobs WHERE state = 'failed'
               AND updated_at > datetime('now', '-24 hours')`,
            )
            .get() as { cnt: number }
        ).cnt ?? 0;
      const checkpoint = new CheckpointStore(db);
      return {
        activeJobs,
        queuedJobs,
        failedJobsLast24h,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        lastPollTimestamp: checkpoint.getLastPollTime(org.github.host),
      };
    },
    enqueuedJobs,
  };
}

export function createBootstrap(input: BootstrapInput): {
  config: RuntimeConfig;
  deps: RuntimeDeps;
  context: BootstrapContext;
} {
  const local = loadLocalConfig(input.localConfigPath);
  const org = loadOrganizationConfig(join(input.appRoot, "config/organization.json"));
  const profile = loadProfileConfig(join(local.profileDirectory, "profile.json"));
  const policyPath = join(local.profileDirectory, "policy.json");
  const policy = existsSync(policyPath)
    ? loadPolicyConfig(policyPath)
    : ({ repositories: {}, autoAnalyze: { explicitReviewRequests: true, priorityTiers: ["p0", "p1"] }, attentionAdvisor: { enabled: false, maxCandidatesPerInvocation: 5, timeoutSeconds: 90 } } as PolicyConfig);

  const dbPath = join(local.dataDirectory, "control-tower.sqlite");
  const db = openDatabase(dbPath);
  const operatorLogin = normalizeLogin(profile.githubLogin);
  const host = org.github.host;
  const ghAdapter = new GitHubAdapter(host, (args, opts) => execGhJson(args, opts));
  const rateLimits = new RateLimitTracker();
  const checkpoints = new CheckpointStore(db);
  const enqueueDeps = buildEnqueueDeps(db);
  const workGraph = new WorkGraph(db);
  const guardStore = new GuardInputStore();
  let authenticatedLogin = operatorLogin;

  const publisher = new PublisherService({
    ghAdapter: createGhPublishAdapter(host),
    authenticatedLogin: operatorLogin,
    configuredOperator: operatorLogin,
  });

  const clientDistPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../client/dist",
  );

  const signalRecorder = new SignalRecorder(db);
  const proposalStore = new FilesystemProposalStore(local.dataDirectory);

  const context: BootstrapContext = {
    db,
    guardStore,
    publisher,
    publicationMode: local.publication.mode,
    configuredOperator: operatorLogin,
    authenticatedLogin,
    clientDistPath,
    signalRecorder,
    proposalStore,
    profileDirectory: local.profileDirectory,
    dataDirectory: local.dataDirectory,
    appRoot: input.appRoot,
  };

  let lastValidLocal: LocalConfig = local;

  const reloadLocalConfig = (): LocalConfig => {
    try {
      const reloaded = loadLocalConfig(input.localConfigPath);
      lastValidLocal = reloaded;
      context.publicationMode = reloaded.publication.mode;
      return reloaded;
    } catch (err) {
      console.error(
        `Config reload failed (${err instanceof Error ? err.message : String(err)}), retaining last-valid config`,
      );
      context.publicationMode = lastValidLocal.publication.mode;
      return lastValidLocal;
    }
  };

  const facadeDeps = buildFacadeDeps(
    db,
    workGraph,
    enqueueDeps,
    policy,
    profile,
    org,
    local,
    context,
    local.dataDirectory,
  );

  const persistDecision = createPersistDecision(
    db,
    (pr) => resolveRepositoryKey(org, pr),
    (pr) => resolveSourceMode(local, pr),
  );

  const pollConfig = {
    host,
    organizations: org.github.organizations,
    operatorLogin,
    activeRepositoryIds: profile.activeRepositoryIds,
    repositories: org.repositories.map((r) => ({ id: r.id, github: r.github })),
    baseBackoffMs: 5_000,
    maxBackoffMs: 300_000,
  };

  const config: RuntimeConfig = {
    port: local.daemon?.port ?? 9120,
    schedulerIntervalMs: 5_000,
    attentionIntervalMs: 60_000,
    dataDirectory: local.dataDirectory,
  };

  const deps: RuntimeDeps = {
    migrate() {
      runMigrations(db);
      signalRecorder.initialize();
    },
    recoverOrphanedStates() {
      return recoverOrphanedStates(db);
    },
    startDiscoveryPoller() {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const schedule = (delayMs: number) => {
        if (stopped) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          if (stopped) return;
          await poller.poll();
          schedule(org.github.pollIntervalSeconds * 1000);
        }, delayMs);
      };

      const poller = new ResilientPoller({
        verifyIdentity: async () => {
          const health = await verifyOperatorIdentity(
            host,
            operatorLogin,
            (args, opts) => execGhText(args, opts),
          );
          if (health.authenticatedLogin) {
            authenticatedLogin = health.authenticatedLogin;
            context.authenticatedLogin = health.authenticatedLogin;
          }
          return health;
        },
        searchReviewRequested: (login, orgs) =>
          ghAdapter.searchReviewRequested(login, orgs),
        listRepoPrs: (ownerRepo) => ghAdapter.listRepoPrs(ownerRepo),
        enrichPr: (ownerRepo, prNumber) => ghAdapter.viewPr(ownerRepo, prNumber),
        upsertRepository: (repo) => {
          const catalog = org.repositories.find((r) => r.id === repo.id);
          upsertRepository(db, {
            id: repo.id,
            github: repo.github,
            host: repo.host,
            defaultBranch: catalog?.defaultBranch ?? "main",
            resourceClass: catalog?.resourceClass ?? "medium",
          });
        },
        upsertPr: (raw, repositoryId, explicitRequest) => {
          if (
            typeof raw === "object" &&
            raw !== null &&
            "prNumber" in raw &&
            "headSha" in raw
          ) {
            return upsertDiscoveredPr(db, raw as DiscoveredPr);
          }
          return upsertDiscoveredPr(db, {
            ...(raw as object),
            repositoryId,
            explicitRequest,
          } as DiscoveredPr);
        },
        evaluateAndEnqueue: (_prId, raw, explicitRequest) => {
          const pr = raw as DiscoveredPr;
          const repositoryKey = resolveRepositoryKey(org, pr);
          const sourceMode = resolveSourceMode(local, pr);
          const repoPolicy = policy.repositories[repositoryKey] ?? null;
          const decision = evaluatePolicy({
            pr,
            activeRepositoryIds: profile.activeRepositoryIds,
            repositoryPolicy: repoPolicy,
            autoAnalyzeConfig: policy.autoAnalyze,
            operatorLogin,
          });
          enqueueFromPolicyDecision(enqueueDeps, {
            repositoryKey,
            prNumber: pr.prNumber,
            headSha: pr.headSha,
            sourceMode,
            policy: decision,
            normalizedRepositoryIdentity: repositoryKey,
            explicitRequest,
          });
        },
        evaluatePolicy: (pr) => {
          const repositoryKey = resolveRepositoryKey(org, pr);
          const repoPolicy = policy.repositories[repositoryKey] ?? null;
          return evaluatePolicy({
            pr,
            activeRepositoryIds: profile.activeRepositoryIds,
            repositoryPolicy: repoPolicy,
            autoAnalyzeConfig: policy.autoAnalyze,
            operatorLogin,
          });
        },
        persistDecision,
        countKnownPrs: () =>
          (db.prepare(`SELECT COUNT(*) as cnt FROM prs`).get() as { cnt: number }).cnt,
        getFreshnessAt: (h) => checkpoints.getLastPollTime(h),
        setFreshnessAt: (h, at) => {
          checkpoints.set(`poll:${h}:lastCompleted`, h, at, { freshnessAt: at });
        },
        rateLimits,
        scheduleNextPoll: (delayMs) => schedule(delayMs),
        config: pollConfig,
        random: Math.random,
        execGhJson: (args, opts) => execGhJson(args, opts),
      });

      schedule(0);

      return {
        stop() {
          stopped = true;
          if (timer) clearTimeout(timer);
        },
      };
    },
    runSchedulerTick() {
      reloadLocalConfig();
      const currentLocal = lastValidLocal;
      const decision = selectNextJobs(db, {
        maxConcurrentAgents: currentLocal.cursor.maxConcurrentAgents,
        debounceMs: 2_000,
      });
      for (const jobId of decision.jobsToStart) {
        void runPipelineForJob(
          db,
          {
            dataDirectory: currentLocal.dataDirectory,
            signalRecorder: context.signalRecorder,
            modelSpecHash: sha256Hex(
              currentLocal.cursor.modelRoles.primaryReview?.modelId ??
                "primary-review-default",
            ),
          },
          jobId,
        ).catch((err) => {
          console.error(`Pipeline failed for job ${jobId}:`, err);
        });
      }
      return decision;
    },
    runAttentionBatch() {
      if (!policy.attentionAdvisor?.enabled) return;
      // Advisor batch invocation deferred; focus queue supports client-side advisor ordering.
    },
    createFacade() {
      return createOrchestratorFacade(facadeDeps);
    },
    publishContext: {
      guardStore: context.guardStore,
      publisher: context.publisher,
      clientDistPath: context.clientDistPath,
      publicationMode: context.publicationMode,
      configuredOperator: context.configuredOperator,
      authenticatedLogin: context.authenticatedLogin,
      signalRecorder: context.signalRecorder,
      proposalStore: context.proposalStore,
      profileDirectory: context.profileDirectory,
      dataDirectory: context.dataDirectory,
      getProfileFiles: () => loadProfileFiles(context.profileDirectory),
      startProposal: (signalRunIds) => {
        const modelSpec =
          local.cursor.modelRoles.primaryReview?.modelId ?? "primary-review-default";
        const cursorAdapter: CursorRunAdapter = {
          async run(prompt) {
            const parsed = JSON.parse(prompt) as {
              signals?: Array<{ type: string; modelRole: string }>;
            };
            const attentionSignals =
              parsed.signals?.filter((s) => s.modelRole === "attention").length ?? 0;
            const personaPath = join(context.profileDirectory, "persona.md");
            const personaContent = existsSync(personaPath)
              ? readFileSync(personaPath, "utf-8")
              : "# Persona\n";
            const annotation =
              attentionSignals > 0
                ? `\n\n<!-- proposal: ${attentionSignals} attention signal(s) -->\n`
                : "\n";
            return {
              exitCode: 0,
              output: {
                targets: [
                  {
                    path: "persona.md",
                    proposedContent: personaContent.endsWith("\n")
                      ? `${personaContent.trimEnd()}${annotation}`
                      : `${personaContent}${annotation}`,
                    rationale: `Informed by ${parsed.signals?.length ?? 0} learning signal(s)`,
                    expectedEffect: "Calibrate review attention based on historical outcomes",
                    risks: ["Requires validation against current profile hashes"],
                    replayCases: [],
                  },
                ],
              },
            };
          },
        };
        const currentFiles = loadProfileFiles(context.profileDirectory);
        return startProposalFromSignals({
          signalRunIds,
          recorder: context.signalRecorder,
          currentFiles,
          profileDir: context.profileDirectory,
          corpusCases: loadCorpusCases(context.appRoot, "attention"),
          modelSpec,
          evaluator: defaultProposalEvaluator(),
          cursorAdapter,
        });
      },
      getAllTrackedRows: () =>
        projectAllTracked(db, workGraph.getAllTracked()),
      getFocusQueueRows: () =>
        projectFocusQueue(db, workGraph.getFocusQueue()),
      getJobDetail: (id) => loadJobDetail(db, id),
      getDraftDetail: (jobId) => facadeDeps.getDraft(jobId),
      recordPublishedDisposition: (operationHash) => {
        const guardCtx = context.guardStore.getContext(operationHash);
        if (!guardCtx) return;
        const jobRow = db
          .prepare(
            `SELECT j.id, j.policy_hash, j.source_mode, r.id as run_id, r.run_input_hash
             FROM jobs j
             JOIN runs r ON r.id = j.accepted_run_id
             WHERE j.id = (
               SELECT job_id FROM runs WHERE id = ?
             )`,
          )
          .get(guardCtx.approvedRunId) as
          | {
              id: string;
              policy_hash: string;
              source_mode: "registered-source" | "remote-evidence-only";
              run_id: string;
              run_input_hash: string;
            }
          | undefined;
        if (!jobRow) return;

        const hooks = createPrimaryReviewSignalHooks(
          db,
          context.signalRecorder,
          jobRow.id,
          jobRow.run_id,
          sha256Hex(
            lastValidLocal.cursor.modelRoles.primaryReview?.modelId ??
              "primary-review-default",
          ),
        );
        hooks.onDisposition(
          mapOperationTypeToDisposition(guardCtx.operationType),
        );
      },
    },
  };

  return { config, deps, context };
}
