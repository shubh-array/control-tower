import type { PolicyDecision } from '../policy/evaluate.js';

export interface EnqueueInput {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  sourceMode: 'registered-source' | 'remote-evidence-only';
  policy: PolicyDecision;
  normalizedRepositoryIdentity: string;
  explicitRequest: boolean;
}

export interface EnqueueResult {
  enqueued: boolean;
  jobId?: string;
  superseded?: string;
  reason: string;
}

export interface EnqueueDeps {
  findActiveJobByIdentity(identityHash: string): {
    id: string;
    head_sha: string;
    policy_hash: string;
    source_mode: string;
    state: string;
    version: number;
  } | null;
  insertJob(row: Record<string, unknown>): string;
  supersede(jobId: string, version: number): void;
  computeIdentityHash(input: Record<string, unknown>): string;
  computePolicyHash(decision: PolicyDecision): string;
}

export function enqueueFromPolicyDecision(
  deps: EnqueueDeps,
  input: EnqueueInput,
): EnqueueResult {
  if (!input.policy.eligible) {
    return { enqueued: false, reason: 'ineligible' };
  }

  const shouldEnqueue =
    input.policy.analysisMode === 'auto' ||
    (input.policy.analysisMode === 'on_demand' && input.explicitRequest);

  if (!shouldEnqueue) {
    return { enqueued: false, reason: 'on_demand_no_request' };
  }

  const identityHash = deps.computeIdentityHash({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    sourceMode: input.sourceMode,
  });

  const policyHash = deps.computePolicyHash(input.policy);

  const existing = deps.findActiveJobByIdentity(identityHash);
  if (existing) {
    let supersedeReason: string | null = null;
    if (existing.head_sha !== input.headSha) {
      supersedeReason = 'supersede_head_sha';
    } else if (existing.policy_hash !== policyHash) {
      supersedeReason = 'supersede_policy_hash';
    } else if (existing.source_mode !== input.sourceMode) {
      supersedeReason = 'supersede_source_mode';
    }

    if (!supersedeReason) {
      return { enqueued: false, jobId: existing.id, reason: 'existing_job_current' };
    }

    deps.supersede(existing.id, existing.version);

    const jobId = deps.insertJob({
      repositoryKey: input.repositoryKey,
      prNumber: input.prNumber,
      headSha: input.headSha,
      sourceMode: input.sourceMode,
      policyHash,
      identityHash,
      normalizedRepositoryIdentity: input.normalizedRepositoryIdentity,
      prioritySortOrdinal: input.policy.prioritySortOrdinal,
      explicitRequestSort: input.explicitRequest ? 0 : 1,
      queuedAt: new Date().toISOString(),
      state: 'queued',
    });

    return { enqueued: true, jobId, superseded: existing.id, reason: supersedeReason };
  }

  const reason = input.explicitRequest ? 'explicit_request' : 'auto_enqueue';
  const jobId = deps.insertJob({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    sourceMode: input.sourceMode,
    policyHash,
    identityHash,
    normalizedRepositoryIdentity: input.normalizedRepositoryIdentity,
    prioritySortOrdinal: input.policy.prioritySortOrdinal,
    explicitRequestSort: input.explicitRequest ? 0 : 1,
    queuedAt: new Date().toISOString(),
    state: 'queued',
  });

  return { enqueued: true, jobId, reason };
}
