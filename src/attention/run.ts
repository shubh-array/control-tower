import type { SelectedCandidate } from './candidates.js';
import type { BatchStalenessInput } from './staleness.js';
import { validateAttentionOutput, type AttentionValidationInput } from './validate-output.js';

export interface AttentionRunConfig {
  timeoutMs: number; // default 90_000
  attentionModelSpecification: { modelId: string; hash: string };
}

export interface AttentionRunInput {
  candidates: SelectedCandidate[];
  batchIdentity: BatchStalenessInput;
  manifestHash: string;
  policySnapshotHash: string;
}

export interface AttentionRunResult {
  runId: string;
  batchIdentityHash: string;
  success: boolean;
  validationResult?: { valid: boolean; errors: string[] };
  failureReason?: string;
}

export function buildAttentionRunDirectory(runId: string, dataDir: string): string {
  return `${dataDir}/attention-runs/${runId}`;
}

export function buildAttentionCandidateMetadata(candidates: SelectedCandidate[]): object[] {
  return candidates.map(c => ({
    repositoryKey: c.repositoryKey,
    prNumber: c.prNumber,
    headSha: c.headSha,
    baseSha: c.baseSha,
    title: c.title,
    author: c.author,
    draft: c.draft,
    labels: c.labels,
    additions: c.additions,
    deletions: c.deletions,
    changedFiles: c.changedFiles,
    reviewRequested: c.reviewRequested,
    checkSummary: c.checkSummary,
    updatedAt: c.updatedAt,
    bodyTruncated: c.bodyTruncated,
  }));
}

export function validateAttentionRunResult(
  rawOutput: unknown,
  candidates: SelectedCandidate[],
): { valid: boolean; errors: string[]; parsed?: { schemaVersion: number; items: unknown[] } } {
  if (typeof rawOutput !== 'object' || rawOutput === null) {
    return { valid: false, errors: ['output is not an object'] };
  }

  const output = rawOutput as Record<string, unknown>;
  const input: AttentionValidationInput = {
    candidates: candidates.map(c => ({
      repositoryKey: c.repositoryKey,
      prNumber: c.prNumber,
      headSha: c.headSha,
    })),
  };

  return validateAttentionOutput(output as Parameters<typeof validateAttentionOutput>[0], input);
}
