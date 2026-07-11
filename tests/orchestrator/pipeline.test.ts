// tests/orchestrator/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import {
  executePipeline,
  type PipelineDeps,
  type PipelineJob,
} from '../../src/orchestrator/pipeline.js';

function makeFakeDeps(options: { shouldFail?: string } = {}): PipelineDeps {
  const transitions: Array<{ jobId: string; from: string; to: string }> = [];
  const runTransitions: Array<{ runId: string; from: string; to: string }> = [];
  let currentJobState = 'queued';
  let currentRunState = 'allocated';
  let jobVersion = 1;
  let runVersion = 1;

  return {
    transitions,
    runTransitions,

    transitionJob(jobId: string, from: string, to: string) {
      if (options.shouldFail === to) {
        throw new Error(`simulated failure at ${to}`);
      }
      transitions.push({ jobId, from, to });
      currentJobState = to;
      jobVersion++;
      return { success: true, newVersion: jobVersion };
    },

    transitionRun(runId: string, from: string, to: string) {
      runTransitions.push({ runId, from, to });
      currentRunState = to;
      runVersion++;
      return { success: true, newVersion: runVersion };
    },

    allocateRun(jobId: string) {
      return { runId: `run-${jobId}`, version: 1 };
    },

    prepareContext(_jobId: string, runId: string) {
      return {
        runDir: `/tmp/runs/${runId}`,
        manifest: { layers: 9 },
        coverage: { sourceMode: 'registered-source', inspected: true },
      };
    },

    prepareSource(_jobId: string, runId: string) {
      return {
        sourceViewRoot: `/tmp/source/${runId}`,
        adminWorktree: `/tmp/admin/${runId}`,
      };
    },

    runAgent(_runId: string, _runDir: string) {
      return {
        rawOutput: '{"schemaVersion":1}',
        exitCode: 0,
        modelId: 'claude-sonnet-4-20250514',
      };
    },

    validateOutput(_rawOutput: string, _context: Record<string, unknown>) {
      return { valid: true, errors: [], validatedProvenance: [] };
    },

    sealRun(_runId: string, _runDir: string) {
      return { sealed: true };
    },

    updatePointers(_jobId: string, runId: string) {
      return { latestRunId: runId, acceptedRunId: runId };
    },

    cleanupSource(_runId: string) {},

    getJobState(_jobId: string) {
      return { state: currentJobState, version: jobVersion };
    },

    getRunState(_runId: string) {
      return { state: currentRunState, version: runVersion };
    },
  };
}

function makeJob(): PipelineJob {
  return {
    id: 'job-1',
    repositoryKey: 'pba-webapp',
    prNumber: 42,
    headSha: 'a'.repeat(40),
    sourceMode: 'registered-source' as const,
    policyHash: 'policy-hash-1',
    identityHash: 'identity-hash-1',
    version: 1,
  };
}

describe('executePipeline', () => {
  it('reaches draft_ready with fake deps', async () => {
    const deps = makeFakeDeps();
    const job = makeJob();
    const result = await executePipeline(deps, job);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe('draft_ready');
    expect(result.runId).toBeDefined();

    const jobStates = deps.transitions.map(t => t.to);
    expect(jobStates).toContain('preparing_context');
    expect(jobStates).toContain('draft_ready');
  });

  it('transitions through preparing_source for registered-source', async () => {
    const deps = makeFakeDeps();
    const job = makeJob();
    await executePipeline(deps, job);

    const jobStates = deps.transitions.map(t => t.to);
    expect(jobStates).toContain('preparing_source');
    expect(jobStates).toContain('running_agent');
  });

  it('skips preparing_source for remote-evidence-only', async () => {
    const deps = makeFakeDeps();
    const job = { ...makeJob(), sourceMode: 'remote-evidence-only' as const };
    await executePipeline(deps, job);

    const jobStates = deps.transitions.map(t => t.to);
    expect(jobStates).not.toContain('preparing_source');
    expect(jobStates).toContain('running_agent');
  });

  it('seals run and updates pointers on success', async () => {
    const deps = makeFakeDeps();
    const job = makeJob();
    const result = await executePipeline(deps, job);

    expect(result.sealed).toBe(true);
    expect(result.latestRunId).toBe(result.runId);
  });

  it('transitions to failed on context preparation error', async () => {
    const deps = makeFakeDeps({ shouldFail: 'preparing_context' });
    const job = makeJob();

    const result = await executePipeline(deps, job);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('allocation_failed');
  });

  it('cleans up source after run completes', async () => {
    let cleanedUp = false;
    const deps = makeFakeDeps();
    const originalCleanup = deps.cleanupSource;
    deps.cleanupSource = (runId: string) => {
      cleanedUp = true;
      originalCleanup(runId);
    };

    await executePipeline(deps, makeJob());
    expect(cleanedUp).toBe(true);
  });
});
