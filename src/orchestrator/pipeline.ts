import { classifySourceFailure } from '../source/errors.js';

export interface PipelineJob {
  id: string;
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  sourceMode: 'registered-source' | 'remote-evidence-only';
  policyHash: string;
  identityHash: string;
  version: number;
}

export interface PipelineResult {
  success: boolean;
  finalState: string;
  /** Set on failure: 'fetch_failed' | 'materialize_failed' | 'agent_failed' | 'allocation_failed' */
  failureReason?: string;
  /** Set when runAdvisor dep is present */
  advisorStatus?: 'available' | 'unavailable';
  runId: string;
  sealed: boolean;
  latestRunId: string;
  acceptedRunId: string;
}

export interface PipelineDeps {
  transitionJob(jobId: string, from: string, to: string): { success: boolean; newVersion: number };
  transitionRun(runId: string, from: string, to: string): { success: boolean; newVersion: number };
  allocateRun(jobId: string): { runId: string; version: number };
  prepareContext(jobId: string, runId: string): {
    runDir: string;
    manifest: Record<string, unknown>;
    coverage: Record<string, unknown>;
  };
  prepareSource(jobId: string, runId: string): {
    sourceViewRoot: string;
    adminWorktree: string;
  };
  runAgent(runId: string, runDir: string): {
    rawOutput: string;
    exitCode: number;
    modelId: string;
  };
  validateOutput(rawOutput: string, context: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
    validatedProvenance: unknown[];
  };
  sealRun(runId: string, runDir: string): Promise<{ sealed: boolean }> | { sealed: boolean };
  updatePointers(jobId: string, runId: string): { latestRunId: string; acceptedRunId: string };
  cleanupSource(runId: string): void;
  getJobState(jobId: string): { state: string; version: number };
  getRunState(runId: string): { state: string; version: number };
  runAdvisor?: (runId: string) => { advice: unknown };
  transitions: Array<{ jobId: string; from: string; to: string }>;
  runTransitions: Array<{ runId: string; from: string; to: string }>;
}

function failResult(
  runId: string,
  failureReason: string,
  advisorStatus?: 'available' | 'unavailable',
): PipelineResult {
  return {
    success: false,
    finalState: 'failed',
    failureReason,
    advisorStatus,
    runId,
    sealed: false,
    latestRunId: runId,
    acceptedRunId: '',
  };
}

export async function executePipeline(
  deps: PipelineDeps,
  job: PipelineJob,
): Promise<PipelineResult> {
  const { runId } = deps.allocateRun(job.id);
  let advisorStatus: 'available' | 'unavailable' | undefined;

  try {
    deps.transitionJob(job.id, 'queued', 'preparing_context');
    deps.transitionRun(runId, 'allocated', 'running');
  } catch {
    deps.transitionJob(job.id, 'queued', 'failed');
    return failResult(runId, 'allocation_failed');
  }

  let context;
  try {
    context = deps.prepareContext(job.id, runId);
  } catch {
    deps.transitionJob(job.id, 'preparing_context', 'failed');
    try { await deps.sealRun(runId, ''); } catch { /* best-effort seal */ }
    try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }
    return failResult(runId, 'materialize_failed');
  }

  if (job.sourceMode === 'registered-source') {
    try {
      deps.transitionJob(job.id, 'preparing_context', 'preparing_source');
      deps.prepareSource(job.id, runId);
      deps.transitionJob(job.id, 'preparing_source', 'running_agent');
    } catch (err) {
      const failureReason = classifySourceFailure(err);
      try {
        deps.transitionJob(job.id, 'preparing_source', 'failed');
      } catch {
        deps.transitionJob(job.id, 'preparing_context', 'failed');
      }
      try { await deps.sealRun(runId, context.runDir); } catch { /* best-effort seal */ }
      try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }
      return failResult(runId, failureReason);
    }
  } else {
    deps.transitionJob(job.id, 'preparing_context', 'running_agent');
  }

  if (deps.runAdvisor) {
    try {
      deps.runAdvisor(runId);
      advisorStatus = 'available';
    } catch {
      advisorStatus = 'unavailable';
    }
  }

  let agentResult;
  try {
    agentResult = deps.runAgent(runId, context.runDir);
  } catch {
    deps.transitionRun(runId, 'running', 'failed');
    deps.transitionJob(job.id, 'running_agent', 'failed');
    try { await deps.sealRun(runId, context.runDir); } catch { /* best-effort seal */ }
    try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }
    return failResult(runId, 'agent_failed', advisorStatus);
  }

  deps.transitionJob(job.id, 'running_agent', 'validating_output');
  deps.transitionRun(runId, 'running', 'validating');

  const validation = deps.validateOutput(agentResult.rawOutput, context.coverage);
  if (!validation.valid) {
    deps.transitionRun(runId, 'validating', 'failed');
    deps.transitionJob(job.id, 'validating_output', 'failed');
    try { await deps.sealRun(runId, context.runDir); } catch { /* best-effort seal */ }
    try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }
    return failResult(runId, 'agent_failed', advisorStatus);
  }

  deps.transitionRun(runId, 'validating', 'succeeded');

  const { sealed } = await deps.sealRun(runId, context.runDir);
  const pointers = deps.updatePointers(job.id, runId);

  deps.transitionJob(job.id, 'validating_output', 'draft_ready');

  deps.cleanupSource(runId);

  return {
    success: true,
    finalState: 'draft_ready',
    advisorStatus,
    runId,
    sealed,
    latestRunId: pointers.latestRunId,
    acceptedRunId: pointers.acceptedRunId,
  };
}
