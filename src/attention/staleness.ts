import { createHash } from 'node:crypto';

export interface PerPrStalenessInput {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  metadataSnapshotHash: string;
  perPrPolicySubsetHash: string;
  attentionFeatureGuidanceHash: string; // layers 1, 3, 6, 8 only
  attentionModelSpecificationHash: string;
}

export function computePerPrStalenessIdentity(input: PerPrStalenessInput): string {
  const preimage = [
    `repo=${input.repositoryKey}`,
    `pr=${input.prNumber}`,
    `head=${input.headSha}`,
    `metaSnap=${input.metadataSnapshotHash}`,
    `policySubset=${input.perPrPolicySubsetHash}`,
    `guidance=${input.attentionFeatureGuidanceHash}`,
    `model=${input.attentionModelSpecificationHash}`,
  ].join('\n');

  return createHash('sha256').update(preimage).digest('hex');
}

export interface BatchStalenessInput {
  orderedCandidateMetadataSnapshotHash: string;
  relevantPolicyHash: string;
  completeAttentionManifestHash: string;
  attentionModelSpecificationHash: string;
}

export function computeBatchIdentity(input: BatchStalenessInput): string {
  const preimage = [
    `role=attention`,
    `candidates=${input.orderedCandidateMetadataSnapshotHash}`,
    `policy=${input.relevantPolicyHash}`,
    `manifest=${input.completeAttentionManifestHash}`,
    `model=${input.attentionModelSpecificationHash}`,
  ].join('\n');

  return createHash('sha256').update(preimage).digest('hex');
}

export function computeMetadataSnapshotHash(candidate: {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: Array<{ name: string; status: string; conclusion: string | null }>;
  bodyTruncated: string;
}): string {
  const canonical = JSON.stringify({
    author: candidate.author,
    bodyHash: createHash('sha256').update(candidate.bodyTruncated).digest('hex'),
    changedFiles: [...candidate.changedFiles].sort(),
    checkSummary: candidate.checkSummary.map(c => `${c.name}:${c.status}:${c.conclusion}`).sort(),
    draft: candidate.draft,
    headSha: candidate.headSha,
    labels: [...candidate.labels].sort(),
    prNumber: candidate.prNumber,
    repositoryKey: candidate.repositoryKey,
    reviewRequested: candidate.reviewRequested,
    title: candidate.title,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
