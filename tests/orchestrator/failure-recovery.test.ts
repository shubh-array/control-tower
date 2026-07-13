// tests/orchestrator/failure-recovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  failJobFetch,
  failJobMaterialize,
  markAdvisorUnavailable,
  failAgentRun,
  type FailureRecoveryDeps,
} from '../../src/orchestrator/failure-recovery.js';
import { executePipeline, type PipelineDeps, type PipelineJob } from '../../src/orchestrator/pipeline.js';
import { SourceMaterializeError } from '../../src/source/errors.js';
import { createOrchestratorFacade, type FacadeDeps } from '../../src/orchestrator/facade.js';
import type { AllTrackedItem } from '../../src/policy/evaluate.js';

// ── Unit test helpers ──────────────────────────────────────────

interface JobRow {
  id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  repository_key: string;
  pr_number: number;
  analysis_mode?: string;
}

interface RunRow {
  id: string;
  job_id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  attempt_number: number;
  sealed_at: string | null;
}

interface AttentionRow {
  id: string;
  repository_key: string;
  pr_number: number;
  analysis_mode: string;
  advisor_status: string | null;
  auto_analyze: number;
}

function createFakeDb() {
  const jobs = new Map<string, JobRow>();
  const runs = new Map<string, RunRow>();
  const attention = new Map<string, AttentionRow>();

  return {
    jobs,
    runs,
    attention,
    getJob(id: string): JobRow | undefined {
      return jobs.get(id);
    },
    getRun(id: string): RunRow | undefined {
      return runs.get(id);
    },
    getAttention(id: string): AttentionRow | undefined {
      return attention.get(id);
    },
    updateJob(id: string, patch: Partial<JobRow>): void {
      const row = jobs.get(id);
      if (!row) throw new Error(`job not found: ${id}`);
      jobs.set(id, { ...row, ...patch, version: row.version + 1 });
    },
    updateRun(id: string, patch: Partial<RunRow>): void {
      const row = runs.get(id);
      if (!row) throw new Error(`run not found: ${id}`);
      runs.set(id, { ...row, ...patch, version: row.version + 1 });
    },
    updateAttention(id: string, patch: Partial<AttentionRow>): void {
      const row = attention.get(id);
      if (!row) throw new Error(`attention not found: ${id}`);
      attention.set(id, { ...row, ...patch });
    },
    listJobsForTracked(): JobRow[] {
      return [...jobs.values()];
    },
    listAttention(): AttentionRow[] {
      return [...attention.values()];
    },
  };
}

type FakeDb = ReturnType<typeof createFakeDb>;

function makeRecoveryDeps(db: FakeDb, overrides?: Partial<FailureRecoveryDeps>): FailureRecoveryDeps {
  return {
    getJob: (id) => db.getJob(id) ?? null,
    getRun: (id) => db.getRun(id) ?? null,
    getAttentionByIdentity: (identity) => {
      const row = [...db.attention.values()].find(
        (a) => `${a.repository_key}#${a.pr_number}` === identity,
      );
      return row ?? null;
    },
    transitionJobFailed: (jobId, reason) => {
      db.updateJob(jobId, { state: 'failed', failure_reason: reason });
    },
    transitionRunFailed: (runId, reason, sealedAt) => {
      db.updateRun(runId, {
        state: 'failed',
        failure_reason: reason,
        sealed_at: sealedAt,
      });
    },
    setAdvisorStatus: (attentionId, status) => {
      db.updateAttention(attentionId, { advisor_status: status });
    },
    getAllTracked: () =>
      db.listAttention().map((a) => ({
        repositoryKey: a.repository_key,
        prNumber: a.pr_number,
        analysisMode: a.analysis_mode,
        advisorStatus: a.advisor_status,
      })),
    cleanupSourcePair: vi.fn().mockResolvedValue(undefined),
    sealRun: vi.fn().mockResolvedValue(undefined),
    createRetryAttempt: vi.fn().mockReturnValue('run-retry-1'),
    ...overrides,
  };
}

// ── Pipeline integration helpers ───────────────────────────────

function makeJob(overrides: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: 'job-1',
    repositoryKey: 'pba-webapp',
    prNumber: 42,
    headSha: 'a'.repeat(40),
    sourceMode: 'registered-source',
    policyHash: 'policy-p1',
    identityHash: 'identity-1',
    version: 1,
    ...overrides,
  };
}

function makeBaseDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  let jobVersion = 1;
  let runVersion = 1;
  return {
    transitions: [],
    runTransitions: [],
    transitionJob(_jobId, _from, _to) {
      jobVersion++;
      return { success: true, newVersion: jobVersion };
    },
    transitionRun(_runId, _from, _to) {
      runVersion++;
      return { success: true, newVersion: runVersion };
    },
    allocateRun(_jobId) { return { runId: `run-${_jobId}`, version: 1 }; },
    prepareSource(_jobId, runId) {
      return { sourceViewRoot: `/tmp/source/${runId}`, adminWorktree: `/tmp/admin/${runId}` };
    },
    prepareContext(_jobId, runId) {
      return { runDir: `/tmp/runs/${runId}`, manifest: { layers: 9 }, coverage: { sourceMode: 'registered-source', inspected: true } };
    },
    runAgent(_runId, _runDir) {
      return {
        rawOutput: JSON.stringify({
          schemaVersion: 1, coverage: {}, summary: { intent: 'test', implementation: 'test' },
          observations: [], checks: [], findings: [], unknowns: [],
          recommendedDisposition: 'approve',
          draftSummary: { body: 'LGTM', observationIndexes: [], provenanceRefs: [] },
        }),
        exitCode: 0,
        modelId: 'claude-sonnet-4-20250514',
      };
    },
    validateOutput() { return { valid: true, errors: [], validatedProvenance: [] }; },
    sealRun() { return { sealed: true }; },
    updatePointers(_jobId, runId) { return { latestRunId: runId, acceptedRunId: runId }; },
    cleanupSource() {},
    getJobState() { return { state: 'queued', version: jobVersion }; },
    getRunState() { return { state: 'allocated', version: runVersion }; },
    ...overrides,
  } as PipelineDeps;
}

// ── failJobFetch unit tests ────────────────────────────────────

describe('failJobFetch', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.jobs.set('job-1', {
      id: 'job-1',
      state: 'preparing_source',
      version: 2,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 42,
    });
    db.attention.set('att-1', {
      id: 'att-1',
      repository_key: 'pba-webapp',
      pr_number: 42,
      analysis_mode: 'auto',
      advisor_status: 'fresh',
      auto_analyze: 1,
    });
  });

  it('transitions job to failed with reason fetch_failed', () => {
    const deps = makeRecoveryDeps(db);
    failJobFetch(deps, 'job-1');

    const job = db.getJob('job-1')!;
    expect(job.state).toBe('failed');
    expect(job.failure_reason).toBe('fetch_failed');
  });

  it('keeps the item visible in getAllTracked', () => {
    const deps = makeRecoveryDeps(db);
    failJobFetch(deps, 'job-1');

    const tracked = deps.getAllTracked();
    expect(tracked.some((t) => t.repositoryKey === 'pba-webapp' && t.prNumber === 42)).toBe(true);
  });

  it('does not call cleanupSourcePair (fetch never reached materialize)', async () => {
    const deps = makeRecoveryDeps(db);
    failJobFetch(deps, 'job-1');
    expect(deps.cleanupSourcePair).not.toHaveBeenCalled();
  });
});

// ── failJobMaterialize unit tests ──────────────────────────────

describe('failJobMaterialize', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.jobs.set('job-2', {
      id: 'job-2',
      state: 'preparing_source',
      version: 3,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 99,
    });
    db.attention.set('att-2', {
      id: 'att-2',
      repository_key: 'pba-webapp',
      pr_number: 99,
      analysis_mode: 'auto',
      advisor_status: null,
      auto_analyze: 1,
    });
  });

  it('transitions job to failed with reason materialize_failed', () => {
    const deps = makeRecoveryDeps(db);
    const result = failJobMaterialize(deps, 'job-2');

    const job = db.getJob('job-2')!;
    expect(job.state).toBe('failed');
    expect(job.failure_reason).toBe('materialize_failed');
    expect(result.recoveryHint).toEqual({
      action: 'requestAnalyze',
      sourceMode: 'remote-evidence-only',
      repositoryKey: 'pba-webapp',
      prNumber: 99,
    });
  });

  it('keeps the item in getAllTracked after materialize failure', () => {
    const deps = makeRecoveryDeps(db);
    failJobMaterialize(deps, 'job-2');

    expect(
      deps.getAllTracked().some((t) => t.prNumber === 99),
    ).toBe(true);
  });

  it('documents facade.requestAnalyze({sourceMode:"remote-evidence-only"}) as recovery', () => {
    const deps = makeRecoveryDeps(db);
    const result = failJobMaterialize(deps, 'job-2');
    expect(result.recoveryHint.action).toBe('requestAnalyze');
    expect(result.recoveryHint.sourceMode).toBe('remote-evidence-only');
  });
});

// ── markAdvisorUnavailable unit tests ────────────────────────────

describe('markAdvisorUnavailable', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.attention.set('att-3', {
      id: 'att-3',
      repository_key: 'pba-webapp',
      pr_number: 7,
      analysis_mode: 'auto',
      advisor_status: 'fresh',
      auto_analyze: 1,
    });
    db.jobs.set('job-auto-7', {
      id: 'job-auto-7',
      state: 'queued',
      version: 1,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 7,
    });
  });

  it('sets advisor_status to unavailable', () => {
    const deps = makeRecoveryDeps(db);
    markAdvisorUnavailable(deps, 'pba-webapp#7');

    expect(db.getAttention('att-3')!.advisor_status).toBe('unavailable');
  });

  it('does not change analysisMode', () => {
    const deps = makeRecoveryDeps(db);
    markAdvisorUnavailable(deps, 'pba-webapp#7');

    expect(db.getAttention('att-3')!.analysis_mode).toBe('auto');
    const tracked = deps.getAllTracked().find((t) => t.prNumber === 7)!;
    expect(tracked.analysisMode).toBe('auto');
  });

  it('does not cancel auto jobs', () => {
    const deps = makeRecoveryDeps(db);
    markAdvisorUnavailable(deps, 'pba-webapp#7');

    const job = db.getJob('job-auto-7')!;
    expect(job.state).toBe('queued');
    expect(job.failure_reason).toBeNull();
  });
});

// ── failAgentRun unit tests ────────────────────────────────────

describe('failAgentRun', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.jobs.set('job-3', {
      id: 'job-3',
      state: 'running_agent',
      version: 4,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 55,
    });
    db.runs.set('run-1', {
      id: 'run-1',
      job_id: 'job-3',
      state: 'running',
      version: 2,
      failure_reason: null,
      attempt_number: 1,
      sealed_at: null,
    });
    db.attention.set('att-55', {
      id: 'att-55',
      repository_key: 'pba-webapp',
      pr_number: 55,
      analysis_mode: 'on_demand',
      advisor_status: null,
      auto_analyze: 0,
    });
  });

  it('seals the run as failed and records the reason', async () => {
    const deps = makeRecoveryDeps(db);
    await failAgentRun(deps, 'run-1', 'agent_timeout');

    const run = db.getRun('run-1')!;
    expect(run.state).toBe('failed');
    expect(run.failure_reason).toBe('agent_timeout');
    expect(run.sealed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deps.sealRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ outcome: 'failed', failureReason: 'agent_timeout' }),
    );
  });

  it('calls cleanupSourcePair for the job', async () => {
    const deps = makeRecoveryDeps(db);
    await failAgentRun(deps, 'run-1', 'agent_crash');

    expect(deps.cleanupSourcePair).toHaveBeenCalledWith('job-3');
  });

  it('fails the parent job and does not create a new attempt automatically', async () => {
    const deps = makeRecoveryDeps(db);
    await failAgentRun(deps, 'run-1', 'malformed_output');

    expect(db.getJob('job-3')!.state).toBe('failed');
    expect(db.getJob('job-3')!.failure_reason).toBe('malformed_output');
    expect(deps.createRetryAttempt).not.toHaveBeenCalled();
  });

  it('only requestRetry creates a new attempt', async () => {
    const deps = makeRecoveryDeps(db);
    await failAgentRun(deps, 'run-1', 'agent_timeout');

    expect(deps.createRetryAttempt).not.toHaveBeenCalled();

    const newRunId = deps.createRetryAttempt('job-3');
    expect(newRunId).toBe('run-retry-1');
    expect(deps.createRetryAttempt).toHaveBeenCalledWith('job-3');
  });
});

// ── Fetch failure pipeline integration ─────────────────────────

describe('Fetch failure recovery', () => {
  it('fails job with fetch_failed when prepareSource throws', async () => {
    const transitions: Array<{ jobId: string; to: string }> = [];
    const cleanedUp: string[] = [];
    const deps = makeBaseDeps({
      prepareSource() { throw new Error('git fetch failed: connection refused'); },
      transitionJob(jobId, _from, to) {
        transitions.push({ jobId, to });
        return { success: true, newVersion: 2 };
      },
      cleanupSource(runId) { cleanedUp.push(runId); },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('fetch_failed');
    expect(transitions.some(t => t.to === 'failed')).toBe(true);
    expect(cleanedUp.length).toBeGreaterThanOrEqual(1);
  });

  it('fails job with materialize_failed when prepareSource throws SourceMaterializeError', async () => {
    const deps = makeBaseDeps({
      prepareSource() {
        throw new SourceMaterializeError('worktree add failed: checkout conflict');
      },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('materialize_failed');
  });

  it('item remains visible in All Tracked after fetch_failed', () => {
    const facadeDeps: FacadeDeps = {
      getAllTracked: () => [
        {
          repositoryKey: 'pba-webapp',
          prNumber: 42,
          headSha: 'a'.repeat(40),
          baseSha: 'b'.repeat(40),
          title: 'Test',
          url: 'https://github.com/pba-webapp/pull/42',
          author: 'dev',
          draft: false,
          labels: [],
          additions: 0,
          deletions: 0,
          changedFiles: [],
          reviewRequested: true,
          checkSummary: [],
          updatedAt: null,
          explicitRequestTimestamp: null,
          policy: {} as AllTrackedItem['policy'],
          sourceMode: 'registered-source',
          bodyTruncated: '',
        },
      ],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: () => null,
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: () => 'job-2',
      enqueueRetry: () => 'retry-1',
      scheduleAdvice: () => {},
      getHealthStatus: () => ({
        activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 1,
        uptime: 100, lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    };
    const facade = createOrchestratorFacade(facadeDeps);
    const tracked = facade.getAllTracked();

    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.repositoryKey).toBe('pba-webapp');
  });
});

// ── Materialize failure pipeline integration ───────────────────

describe('Materialize failure recovery', () => {
  it('fails job with materialize_failed when prepareContext throws', async () => {
    const transitions: Array<{ jobId: string; to: string }> = [];
    const deps = makeBaseDeps({
      prepareContext() { throw new Error('materialize: checkout conflict'); },
      transitionJob(jobId, _from, to) {
        transitions.push({ jobId, to });
        return { success: true, newVersion: 2 };
      },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('materialize_failed');
  });

  it('requestAnalyze with remote-evidence-only available after materialize failure', () => {
    let lastSourceMode: string | undefined;
    const facadeDeps: FacadeDeps = {
      getAllTracked: () => [],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: () => ({
        jobId: 'job-1',
        repository: 'org/pba-webapp',
        prNumber: 42,
        headSha: 'a'.repeat(40),
        state: 'failed',
        sourceMode: 'registered-source',
        runs: [],
        acceptedRunId: null,
      }),
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: (input) => {
        lastSourceMode = input.sourceMode;
        return 'job-2';
      },
      enqueueRetry: () => 'retry-1',
      scheduleAdvice: () => {},
      getHealthStatus: () => ({
        activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 1,
        uptime: 100, lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    };
    const facade = createOrchestratorFacade(facadeDeps);

    facade.requestAnalyze({
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      sourceMode: 'remote-evidence-only',
    });

    expect(lastSourceMode).toBe('remote-evidence-only');
  });
});

// ── Advisor failure pipeline integration ───────────────────────

describe('Advisor failure recovery', () => {
  it('marks advisor_status unavailable without blocking auto-analysis', async () => {
    const deps = makeBaseDeps({
      runAdvisor() { throw new Error('advisor: model timeout'); },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(true);
    expect(result.finalState).toBe('draft_ready');
    expect(result.advisorStatus).toBe('unavailable');
  });

  it('pipeline reaches same draft_ready state regardless of advisor failure', async () => {
    const depsOk = makeBaseDeps({
      runAdvisor() { return { advice: { items: [] } }; },
    });
    const depsFail = makeBaseDeps({
      runAdvisor() { throw new Error('advisor timeout'); },
    });

    const resultOk = await executePipeline(depsOk, makeJob({ id: 'job-a' }));
    const resultFail = await executePipeline(depsFail, makeJob({ id: 'job-b' }));

    expect(resultOk.success).toBe(true);
    expect(resultFail.success).toBe(true);
    expect(resultOk.finalState).toBe('draft_ready');
    expect(resultFail.finalState).toBe('draft_ready');
    expect(resultOk.advisorStatus).toBe('available');
    expect(resultFail.advisorStatus).toBe('unavailable');
  });
});

// ── Agent timeout/malformed pipeline integration ───────────────

describe('Agent timeout/malformed recovery', () => {
  it('seals failed run on agent timeout', async () => {
    let sealedRunId: string | undefined;
    const deps = makeBaseDeps({
      runAgent() { throw new Error('agent: process timed out after 300s'); },
      sealRun(runId) { sealedRunId = runId; return { sealed: true }; },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('agent_failed');
    expect(sealedRunId).toBeDefined();
  });

  it('seals failed run on malformed agent output', async () => {
    let sealedRunId: string | undefined;
    const deps = makeBaseDeps({
      runAgent() {
        return { rawOutput: 'not json at all', exitCode: 0, modelId: 'test' };
      },
      validateOutput() {
        return { valid: false, errors: ['invalid JSON'], validatedProvenance: [] };
      },
      sealRun(runId) { sealedRunId = runId; return { sealed: true }; },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('agent_failed');
    expect(sealedRunId).toBeDefined();
  });

  it('cleans up admin and source worktrees after agent failure', async () => {
    const cleanedUp: string[] = [];
    const deps = makeBaseDeps({
      runAgent() { throw new Error('timeout'); },
      cleanupSource(runId) { cleanedUp.push(runId); },
    });

    await executePipeline(deps, makeJob());

    expect(cleanedUp.length).toBeGreaterThanOrEqual(1);
  });

  it('only requestRetry creates new attempt after agent failure', () => {
    let retryCreated = false;
    const facadeDeps: FacadeDeps = {
      getAllTracked: () => [],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: () => ({
        jobId: 'job-1',
        repository: 'org/pba-webapp',
        prNumber: 42,
        headSha: 'a'.repeat(40),
        state: 'failed',
        sourceMode: 'registered-source',
        runs: [],
        acceptedRunId: null,
      }),
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: () => 'job-2',
      enqueueRetry: () => { retryCreated = true; return 'run-2'; },
      scheduleAdvice: () => {},
      getHealthStatus: () => ({
        activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 1,
        uptime: 100, lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    };
    const facade = createOrchestratorFacade(facadeDeps);

    facade.requestRetry('job-1');

    expect(retryCreated).toBe(true);
  });
});
