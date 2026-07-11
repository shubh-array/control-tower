// src/orchestrator/failure-recovery.ts

export interface TrackedProjection {
  repositoryKey: string;
  prNumber: number;
  analysisMode: string;
  advisorStatus: string | null;
}

export interface JobSnapshot {
  id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  repository_key: string;
  pr_number: number;
}

export interface RunSnapshot {
  id: string;
  job_id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  attempt_number: number;
  sealed_at: string | null;
}

export interface AttentionSnapshot {
  id: string;
  repository_key: string;
  pr_number: number;
  analysis_mode: string;
  advisor_status: string | null;
  auto_analyze: number;
}

export interface MaterializeRecoveryHint {
  action: 'requestAnalyze';
  sourceMode: 'remote-evidence-only';
  repositoryKey: string;
  prNumber: number;
}

export interface FailureRecoveryDeps {
  getJob: (jobId: string) => JobSnapshot | null;
  getRun: (runId: string) => RunSnapshot | null;
  getAttentionByIdentity: (identity: string) => AttentionSnapshot | null;
  transitionJobFailed: (jobId: string, reason: string) => void;
  transitionRunFailed: (runId: string, reason: string, sealedAt: string) => void;
  setAdvisorStatus: (attentionId: string, status: 'unavailable') => void;
  getAllTracked: () => TrackedProjection[];
  cleanupSourcePair: (jobId: string) => Promise<void>;
  sealRun: (
    runId: string,
    record: { outcome: 'failed'; failureReason: string; sealedAt: string },
  ) => Promise<void>;
  /** Only invoked by facade.requestRetry — never by failAgentRun. */
  createRetryAttempt: (jobId: string) => string;
}

/**
 * Authenticated mirror/fetch failure (§12).
 * Terminates the credential-bearing path; item remains in All Tracked.
 */
export function failJobFetch(deps: FailureRecoveryDeps, jobId: string): void {
  const job = deps.getJob(jobId);
  if (!job) throw new Error(`failJobFetch: job not found: ${jobId}`);
  deps.transitionJobFailed(jobId, 'fetch_failed');
}

/**
 * Credential-free SHA/tree/object/materialization failure (§12).
 * Does not silently downgrade to remote-evidence-only.
 * Recovery: facade.requestAnalyze({ sourceMode: 'remote-evidence-only', ... }).
 */
export function failJobMaterialize(
  deps: FailureRecoveryDeps,
  jobId: string,
): { recoveryHint: MaterializeRecoveryHint } {
  const job = deps.getJob(jobId);
  if (!job) throw new Error(`failJobMaterialize: job not found: ${jobId}`);
  deps.transitionJobFailed(jobId, 'materialize_failed');
  return {
    recoveryHint: {
      action: 'requestAnalyze',
      sourceMode: 'remote-evidence-only',
      repositoryKey: job.repository_key,
      prNumber: job.pr_number,
    },
  };
}

/**
 * Attention advisor failure or staleness (§12).
 * Shows unavailable advice; preserves analysis_mode and does not cancel auto jobs.
 */
export function markAdvisorUnavailable(
  deps: FailureRecoveryDeps,
  identity: string,
): void {
  const item = deps.getAttentionByIdentity(identity);
  if (!item) throw new Error(`markAdvisorUnavailable: identity not found: ${identity}`);
  deps.setAdvisorStatus(item.id, 'unavailable');
}

/**
 * Agent timeout / crash / malformed output (§12).
 * Seals the immutable run as failed, removes admin/source pair,
 * and leaves retry to facade.requestRetry → createRetryAttempt only.
 */
export async function failAgentRun(
  deps: FailureRecoveryDeps,
  runId: string,
  reason: string,
): Promise<void> {
  const run = deps.getRun(runId);
  if (!run) throw new Error(`failAgentRun: run not found: ${runId}`);

  const sealedAt = new Date().toISOString();
  deps.transitionRunFailed(runId, reason, sealedAt);
  await deps.sealRun(runId, {
    outcome: 'failed',
    failureReason: reason,
    sealedAt,
  });
  await deps.cleanupSourcePair(run.job_id);
  deps.transitionJobFailed(run.job_id, reason);
}
