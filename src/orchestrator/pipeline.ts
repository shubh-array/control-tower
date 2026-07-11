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
  sealRun(runId: string, runDir: string): { sealed: boolean };
  updatePointers(jobId: string, runId: string): { latestRunId: string; acceptedRunId: string };
  cleanupSource(runId: string): void;
  getJobState(jobId: string): { state: string; version: number };
  getRunState(runId: string): { state: string; version: number };
  transitions: Array<{ jobId: string; from: string; to: string }>;
  runTransitions: Array<{ runId: string; from: string; to: string }>;
}

export async function executePipeline(
  deps: PipelineDeps,
  job: PipelineJob,
): Promise<PipelineResult> {
  const { runId } = deps.allocateRun(job.id);

  deps.transitionJob(job.id, 'queued', 'preparing_context');
  deps.transitionRun(runId, 'allocated', 'running');

  const context = deps.prepareContext(job.id, runId);

  if (job.sourceMode === 'registered-source') {
    deps.transitionJob(job.id, 'preparing_context', 'preparing_source');
    deps.prepareSource(job.id, runId);
    deps.transitionJob(job.id, 'preparing_source', 'running_agent');
  } else {
    deps.transitionJob(job.id, 'preparing_context', 'running_agent');
  }

  const agentResult = deps.runAgent(runId, context.runDir);

  deps.transitionJob(job.id, 'running_agent', 'validating_output');
  deps.transitionRun(runId, 'running', 'validating');

  const validation = deps.validateOutput(agentResult.rawOutput, context.coverage);

  if (!validation.valid) {
    deps.transitionRun(runId, 'validating', 'failed');
    deps.transitionJob(job.id, 'validating_output', 'failed');
    deps.cleanupSource(runId);
    return {
      success: false,
      finalState: 'failed',
      runId,
      sealed: false,
      latestRunId: runId,
      acceptedRunId: '',
    };
  }

  deps.transitionRun(runId, 'validating', 'succeeded');

  const { sealed } = deps.sealRun(runId, context.runDir);
  const pointers = deps.updatePointers(job.id, runId);

  deps.transitionJob(job.id, 'validating_output', 'draft_ready');

  deps.cleanupSource(runId);

  return {
    success: true,
    finalState: 'draft_ready',
    runId,
    sealed,
    latestRunId: pointers.latestRunId,
    acceptedRunId: pointers.acceptedRunId,
  };
}
