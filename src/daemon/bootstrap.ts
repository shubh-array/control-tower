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
import type { LocalConfig, OrganizationConfig, PolicyConfig } from "../config/types.js";
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
  deleteReviewPr,
  upsertEligiblePr,
  upsertRepository,
} from "../normalize/upsert.js";
import type { DiscoveredPr } from "../github/types.js";
import { GuardInputStore } from "../publisher/guard-store.js";
import { PublisherService } from "../publisher/publisher-service.js";
import { createGhPublishAdapter } from "../github/gh-publish-adapter.js";
import { registerDraftOperations } from "../publisher/register-draft.js";
import { loadDraftBundle } from "../orchestrator/draft-loader.js";
import { loadJobDetail } from "../api/projections/job.js";
import { projectFocusQueue } from "../api/projections/queue.js";
import { PrNotEligibleForReviewError } from "../orchestrator/analyze-errors.js";
import type { PolicyDecision } from "../policy/evaluate.js";
import { createRetryAttempt } from "../orchestrator/retry.js";
import { runPipelineForJob } from "../orchestrator/pipeline-runner.js";
import type { RuntimeDeps, RuntimeConfig } from "./runtime.js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

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
    findActiveJobsByPr(repositoryKey: string, prNumber: number) {
      return db
        .prepare(
          `SELECT id, head_sha, policy_hash, source_mode, state, version
           FROM jobs
           WHERE repository_key = ? AND pr_number = ?
             AND state NOT IN ('superseded', 'cancelled', 'published', 'failed')`,
        )
        .all(repositoryKey, prNumber) as Array<{
          id: string;
          head_sha: string;
          policy_hash: string;
          source_mode: string;
          state: string;
          version: number;
        }>;
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
  org: OrganizationConfig,
  local: LocalConfig,
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
        currentHeadSha: bundle.detail.currentHeadSha,
        reviewedHeadSha: bundle.headSha,
        acceptedRunId: bundle.acceptedRunId,
        approvedRunInputHash: bundle.runInputHash,
      },
    );
  };

  return {
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
          `SELECT head_sha, repository_id, policy_json, explicit_request
           FROM prs
           WHERE repository_id = ? AND pr_number = ?`,
        )
        .get(input.repositoryKey, input.prNumber) as
        | {
            head_sha: string;
            repository_id: string;
            policy_json: string;
            explicit_request: number;
          }
        | undefined;

      if (!prRow) {
        throw new PrNotEligibleForReviewError();
      }

      const policy = JSON.parse(prRow.policy_json) as PolicyDecision;
      if (!policy.eligible) {
        throw new PrNotEligibleForReviewError();
      }

      const headSha = prRow.head_sha;
      const sourceMode = resolveSourceMode(local, {
        repositoryId: prRow.repository_id,
        githubOwnerRepo: input.repositoryKey,
        prNumber: input.prNumber,
      } as DiscoveredPr);

      const result = enqueueFromPolicyDecision(enqueueDeps, {
        repositoryKey: input.repositoryKey,
        prNumber: input.prNumber,
        headSha,
        sourceMode,
        policy,
        normalizedRepositoryIdentity: input.repositoryKey,
        explicitRequest: prRow.explicit_request === 1,
        manualRequest: true,
      });

      if (!result.jobId) {
        throw new PrNotEligibleForReviewError();
      }

      return result.jobId;
    },
    enqueueRetry: (jobId: string) => createRetryAttempt(db, jobId),
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
    : ({ repositories: {}, autoAnalyze: { explicitReviewRequests: true, priorityTiers: ["p0", "p1"] } } as PolicyConfig);

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

  const context: BootstrapContext = {
    db,
    guardStore,
    publisher,
    publicationMode: local.publication.mode,
    configuredOperator: operatorLogin,
    authenticatedLogin,
    clientDistPath,
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
    org,
    local,
    context,
    local.dataDirectory,
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
    dataDirectory: local.dataDirectory,
  };

  const deps: RuntimeDeps = {
    migrate() {
      runMigrations(db);
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
        upsertEligiblePr: (pr, decision) => upsertEligiblePr(db, pr, decision),
        retireReviewPr: (repositoryId, prNumber) => {
          const repositoryKey =
            org.repositories.find((r) => r.id === repositoryId)?.id ?? repositoryId;
          for (const job of enqueueDeps.findActiveJobsByPr(repositoryKey, prNumber)) {
            enqueueDeps.supersede(job.id, job.version);
          }
          deleteReviewPr(db, repositoryId, prNumber);
        },
        enqueueEligible: (_prId, pr, decision) => {
          const repositoryKey = resolveRepositoryKey(org, pr);
          const sourceMode = resolveSourceMode(local, pr);
          enqueueFromPolicyDecision(enqueueDeps, {
            repositoryKey,
            prNumber: pr.prNumber,
            headSha: pr.headSha,
            sourceMode,
            policy: decision,
            normalizedRepositoryIdentity: repositoryKey,
            explicitRequest: pr.explicitRequest,
            manualRequest: false,
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
        listPersistedReviewPrs: () =>
          db
            .prepare(
              `SELECT p.repository_id AS repositoryId,
                      r.github_owner || '/' || r.github_repo AS github,
                      p.pr_number AS prNumber
               FROM prs p
               JOIN repositories r ON r.id = p.repository_id`,
            )
            .all() as Array<{
              repositoryId: string;
              github: string;
              prNumber: number;
            }>,
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
            appRoot: context.appRoot,
            profileDirectory: context.profileDirectory,
            repositoryPaths: currentLocal.repositoryPaths,
            protectedPaths: org.security.protectedPaths,
            catalogRepositories: org.repositories.map((r) => ({
              id: r.id,
              github: r.github,
            })),
            cursorBinary: currentLocal.cursor.binary,
            cursorModelId:
              currentLocal.cursor.modelRoles.primaryReview?.modelId,
            // Isolated under dataDirectory/cursor-home unless CONTROL_TOWER_CURSOR_HOME is set.
            cursorHomePath: undefined,
            sshAuthSock: process.env.SSH_AUTH_SOCK,
            execGhText: (args, opts) => execGhText(args, opts),
            githubHost: org.github.host,
          },
          jobId,
        ).catch((err) => {
          console.error(`Pipeline failed for job ${jobId}:`, err);
        });
      }
      return decision;
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
      getFocusQueueRows: () =>
        projectFocusQueue(
          db,
          workGraph.getFocusQueue(),
          checkpoints.getLastPollTime(host),
        ),
      getJobDetail: (id) => loadJobDetail(db, id),
      getDraftDetail: (jobId) => facadeDeps.getDraft(jobId),
    },
  };

  return { config, deps, context };
}
