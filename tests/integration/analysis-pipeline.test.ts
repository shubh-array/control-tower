// tests/integration/analysis-pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PolicyDecision } from '../../src/policy/evaluate.js';
import { enqueueFromPolicyDecision, type EnqueueDeps, type EnqueueInput } from '../../src/orchestrator/enqueue.js';
import { executePipeline, type PipelineDeps, type PipelineJob } from '../../src/orchestrator/pipeline.js';
import { createOrchestratorFacade, type FacadeDeps } from '../../src/orchestrator/facade.js';
import type { DraftDetail, JobDetail } from '../../src/api/contracts.js';
import { startRuntime, stopRuntime, type RuntimeConfig, type RuntimeDeps } from '../../src/daemon/runtime.js';
import { openDatabase } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import { createRetryAttempt } from '../../src/orchestrator/retry.js';
import { selectNextJobs } from '../../src/orchestrator/scheduler.js';

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: 'p1',
    prioritySortOrdinal: 1,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: 'auto',
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function makeEnqueueDeps(): EnqueueDeps & { jobs: Map<string, Record<string, unknown>> } {
  const jobs = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return {
    jobs,
    findActiveJobByIdentity() { return null; },
    findActiveJobsByPr() { return []; },
    insertJob(row) {
      const id = `job-${nextId++}`;
      jobs.set(id, { ...row, id });
      return id;
    },
    supersede() {},
    computeIdentityHash(input) {
      return `hash-${input.repositoryKey}-${input.prNumber}`;
    },
    computePolicyHash(decision) {
      return `policy-${decision.priorityStatus}`;
    },
  };
}

function makePipelineDeps(): PipelineDeps {
  const transitions: Array<{ jobId: string; from: string; to: string }> = [];
  const runTransitions: Array<{ runId: string; from: string; to: string }> = [];
  let jobVersion = 1;
  let runVersion = 1;

  return {
    transitions,
    runTransitions,
    transitionJob(jobId, from, to) {
      transitions.push({ jobId, from, to });
      jobVersion++;
      return { success: true, newVersion: jobVersion };
    },
    transitionRun(runId, from, to) {
      runTransitions.push({ runId, from, to });
      runVersion++;
      return { success: true, newVersion: runVersion };
    },
    allocateRun(_jobId) { return { runId: `run-${_jobId}`, version: 1 }; },
    prepareContext(_jobId, runId) {
      return { runDir: `/tmp/runs/${runId}`, manifest: { layers: 9 }, coverage: { sourceMode: 'registered-source', inspected: true } };
    },
    prepareSource(_jobId, runId) {
      return { sourceViewRoot: `/tmp/source/${runId}`, adminWorktree: `/tmp/admin/${runId}` };
    },
    runAgent(_runId, _runDir) {
      return { rawOutput: '{"schemaVersion":1,"coverage":{},"summary":{"intent":"test","implementation":"test"},"observations":[],"checks":[],"findings":[],"unknowns":[],"recommendedDisposition":"approve","draftSummary":{"body":"LGTM","observationIndexes":[],"provenanceRefs":[]}}', exitCode: 0, modelId: 'claude-sonnet-4-20250514' };
    },
    validateOutput() { return { valid: true, errors: [], validatedProvenance: [] }; },
    sealRun() { return { sealed: true }; },
    updatePointers(_jobId, runId) { return { latestRunId: runId, acceptedRunId: runId }; },
    cleanupSource() {},
    getJobState() { return { state: 'queued', version: jobVersion }; },
    getRunState() { return { state: 'allocated', version: runVersion }; },
  };
}

describe('Integration: poll → policy → auto job queued', () => {
  it('poll fixture produces policy that auto-enqueues a job', () => {
    const deps = makeEnqueueDeps();
    const policy = stubPolicy({ analysisMode: 'auto', priorityStatus: 'p1' });
    const input: EnqueueInput = {
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      sourceMode: 'registered-source',
      policy,
      normalizedRepositoryIdentity: 'github:github.com/org/pba-webapp',
      explicitRequest: false,
      manualRequest: false,
    };

    const result = enqueueFromPolicyDecision(deps, input);
    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe('auto_enqueue');
    expect(deps.jobs.size).toBe(1);
  });
});

describe('Integration: pipeline fake → draft_ready → facade.getDraft returns draft', () => {
  it('pipeline reaches draft_ready and facade can retrieve the draft', async () => {
    const pipelineDeps = makePipelineDeps();
    const job: PipelineJob = {
      id: 'job-1',
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      sourceMode: 'registered-source',
      policyHash: 'policy-p1',
      identityHash: 'identity-1',
      version: 1,
    };

    const pipelineResult = await executePipeline(pipelineDeps, job);
    expect(pipelineResult.success).toBe(true);
    expect(pipelineResult.finalState).toBe('draft_ready');

    const stubDraft: DraftDetail = {
      jobId: 'job-1',
      runId: 'run-1',
      summary: { intent: 'test', implementation: 'test' },
      draftSummary: { body: 'LGTM', observationIndexes: [0], provenanceRefs: [] },
      findings: [],
      observations: [],
      checks: [],
      coverage: {
        mode: 'remote-evidence-only',
        sourceTreeInspected: false,
        diffFiltered: true,
        omittedProtectedPaths: [],
        missingCoverage: [],
      },
      unknowns: [],
      recommendedDisposition: 'approve',
      validatedProvenance: [],
      operationPlan: null,
      reviewedHeadSha: 'a'.repeat(40),
      currentHeadSha: 'a'.repeat(40),
      stale: false,
    };

    const stubJob: JobDetail = {
      jobId: 'job-1',
      repository: 'org/pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      state: 'draft_ready',
      sourceMode: 'registered-source',
      runs: [],
      acceptedRunId: 'run-1',
    };

    const facadeDeps: FacadeDeps = {
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: (id) => (id === 'job-1' ? stubJob : null),
      getDraft: (jobId) => (jobId === 'job-1' ? stubDraft : null),
      getAuditTrail: () => [],
      enqueueAnalysis: () => 'job-new',
      enqueueRetry: () => 'job-retry',
      getHealthStatus: () => ({ activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 0, uptime: 100, lastPollTimestamp: '2026-07-10T00:00:00.000Z' }),
      enqueuedJobs: [],
    };

    const facade = createOrchestratorFacade(facadeDeps);

    const draftResult = facade.getDraft('job-1');
    expect(draftResult).not.toBeNull();
    expect(draftResult!.draftSummary.body).toBe('LGTM');
    expect(draftResult!.jobId).toBe('job-1');
  });
});

describe('Integration: retry then scheduler pipeline allocates exactly one run', () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ct-retry-pipeline-'));
    db = openDatabase(join(tmp, 'test.sqlite'));
    runMigrations(db);
    db.prepare(
      `INSERT INTO jobs (
         id, identity_hash, repository_key, pr_number, head_sha, source_mode,
         policy_hash, state, version, latest_run_id, accepted_run_id, queued_at
       ) VALUES (
         'job-fail', 'hash-fail', 'pba-webapp', 7, ?, 'registered-source', 'ph',
         'failed', 2, 'run-1', 'run-1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
       )`,
    ).run('c'.repeat(40));
    db.prepare(
      `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version)
       VALUES ('run-1', 'job-fail', 1, 'input-1', 'failed', 1)`,
    ).run();
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('requeues without preallocating, then pipeline allocates and executes one run', async () => {
    const returnedJobId = createRetryAttempt(db, 'job-fail');
    expect(returnedJobId).toBe('job-fail');

    const runsBeforePipeline = db
      .prepare(`SELECT COUNT(*) as cnt FROM runs WHERE job_id = 'job-fail'`)
      .get() as { cnt: number };
    expect(runsBeforePipeline.cnt).toBe(1);

    const decision = selectNextJobs(db, {
      maxConcurrentAgents: 1,
      debounceMs: 0,
    });
    expect(decision.jobsToStart).toEqual(['job-fail']);

    const allocateCalls: string[] = [];
    const pipelineDeps = makePipelineDeps();
    pipelineDeps.allocateRun = (jobId) => {
      allocateCalls.push(jobId);
      const maxAttempt =
        (
          db
            .prepare(
              `SELECT MAX(attempt_number) as n FROM runs WHERE job_id = ?`,
            )
            .get(jobId) as { n: number | null }
        ).n ?? 0;
      const runId = `run-${maxAttempt + 1}`;
      db.prepare(
        `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version)
         VALUES (?, ?, ?, ?, 'allocated', 1)`,
      ).run(runId, jobId, maxAttempt + 1, `input-${maxAttempt + 1}`);
      db.prepare(`UPDATE jobs SET latest_run_id = ? WHERE id = ?`).run(runId, jobId);
      return { runId, version: 1 };
    };
    pipelineDeps.transitionRun = (runId, from, to) => {
      pipelineDeps.runTransitions.push({ runId, from, to });
      db.prepare(`UPDATE runs SET state = ?, version = version + 1 WHERE id = ?`).run(to, runId);
      return { success: true, newVersion: 2 };
    };

    const job: PipelineJob = {
      id: 'job-fail',
      repositoryKey: 'pba-webapp',
      prNumber: 7,
      headSha: 'c'.repeat(40),
      sourceMode: 'registered-source',
      policyHash: 'ph',
      identityHash: 'hash-fail',
      version: 3,
    };

    const result = await executePipeline(pipelineDeps, job);
    expect(result.success).toBe(true);
    expect(allocateCalls).toEqual(['job-fail']);

    const runsAfterPipeline = db
      .prepare(`SELECT id, state FROM runs WHERE job_id = 'job-fail' ORDER BY attempt_number`)
      .all() as Array<{ id: string; state: string }>;
    expect(runsAfterPipeline).toHaveLength(2);
    expect(runsAfterPipeline[1]!.id).toBe(result.runId);
    expect(runsAfterPipeline[1]!.state).not.toBe('allocated');

    const stuckAllocated = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM runs WHERE job_id = 'job-fail' AND state = 'allocated'`,
      )
      .get() as { cnt: number };
    expect(stuckAllocated.cnt).toBe(0);
  });
});

describe('Integration: restart recovery then catch-up', () => {
  it('runtime starts, recovers, then catches up via scheduler', async () => {
    let recoveryCalled = false;
    let schedulerTicks = 0;

    const runtimeDeps: RuntimeDeps = {
      migrate() {},
      recoverOrphanedStates() {
        recoveryCalled = true;
        return {
          failedJobs: ['job-orphan-1'],
          failedRuns: ['run-orphan-1'],
          autoRetried: [],
          failureReasons: new Map([['job-orphan-1', 'daemon_restart']]),
          publishingReconciled: [],
        };
      },
      startDiscoveryPoller() {
        return { stop() {} };
      },
      runSchedulerTick() {
        schedulerTicks++;
        return { jobsToStart: [], reason: 'no_eligible_candidates' };
      },
      createFacade() {
        return {
          getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
          getJob: () => null,
          getDraft: () => null,
          getHealthStatus: () => ({ activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 0, uptime: 0, lastPollTimestamp: null }),
          getAuditTrail: () => [],
          requestAnalyze: () => 'job-1',
          requestRetry: () => 'job-1',
        };
      },
    };

    const config: RuntimeConfig = {
      port: 9120,
      apiServerEnabled: false,
      schedulerIntervalMs: 100,
      dataDirectory: '/tmp/test-integration',
    };

    const handle = await startRuntime(config, runtimeDeps);

    expect(recoveryCalled).toBe(true);
    expect(handle.facade).toBeDefined();

    await new Promise(resolve => setTimeout(resolve, 350));
    expect(schedulerTicks).toBeGreaterThanOrEqual(2);

    await stopRuntime(handle);
  });
});
