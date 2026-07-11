// tests/integration/analysis-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import type { PolicyDecision } from '../../src/policy/evaluate.js';
import { enqueueFromPolicyDecision, type EnqueueDeps, type EnqueueInput } from '../../src/orchestrator/enqueue.js';
import { executePipeline, type PipelineDeps, type PipelineJob } from '../../src/orchestrator/pipeline.js';
import { createOrchestratorFacade, type FacadeDeps } from '../../src/orchestrator/facade.js';
import type { DraftDetail, JobDetail } from '../../src/api/contracts.js';
import { startRuntime, stopRuntime, type RuntimeConfig, type RuntimeDeps } from '../../src/daemon/runtime.js';

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
      getAllTracked: () => [],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: (id) => (id === 'job-1' ? stubJob : null),
      getDraft: (jobId) => (jobId === 'job-1' ? stubDraft : null),
      getAuditTrail: () => [],
      enqueueAnalysis: () => 'job-new',
      enqueueRetry: () => 'retry-1',
      scheduleAdvice: () => {},
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
          failedAdvisorRuns: [],
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
      runAttentionBatch() {},
      createFacade() {
        return {
          getAllTracked: () => [],
          getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
          getJob: () => null,
          getDraft: () => null,
          getHealthStatus: () => ({ activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 0, uptime: 0, lastPollTimestamp: null }),
          getAuditTrail: () => [],
          requestAnalyze: () => 'job-1',
          requestRetry: () => 'run-1',
          requestAdvice: () => {},
        };
      },
    };

    const config: RuntimeConfig = {
      port: 9120,
      apiServerEnabled: false,
      schedulerIntervalMs: 100,
      attentionIntervalMs: 100000,
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
