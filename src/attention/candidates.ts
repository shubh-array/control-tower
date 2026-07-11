export interface CandidateInput {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: Array<{ name: string; status: string; conclusion: string | null }>;
  updatedAt: string | null;
  bodyTruncated: string;
  prioritySortOrdinal: number;
  explicitRequestSort: number;
  queueTimestamp: string | null;
  normalizedRepositoryIdentity: string;
  eligible: boolean;
  hasCurrentAdvice: boolean;
  adviceStale: boolean;
  previouslyFailed: boolean;
  previouslyNotScheduled: boolean;
}

export interface CandidateSelectionConfig {
  maxCandidatesPerInvocation: number;
}

export interface SelectedCandidate {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: Array<{ name: string; status: string; conclusion: string | null }>;
  updatedAt: string | null;
  bodyTruncated: string;
  selectionReason: 'never_advised' | 'stale_changed' | 'previously_not_scheduled';
}

export function selectCandidates(
  items: CandidateInput[],
  config: CandidateSelectionConfig,
): SelectedCandidate[] {
  const needsAdvice = items.filter(item => {
    if (item.previouslyFailed) return false;
    if (!item.hasCurrentAdvice) return true;
    if (item.adviceStale) return true;
    if (item.previouslyNotScheduled) return true;
    return false;
  });

  needsAdvice.sort((a, b) => {
    if (a.prioritySortOrdinal !== b.prioritySortOrdinal) return a.prioritySortOrdinal - b.prioritySortOrdinal;
    if (a.explicitRequestSort !== b.explicitRequestSort) return a.explicitRequestSort - b.explicitRequestSort;
    const aTs = a.queueTimestamp ?? '\uffff';
    const bTs = b.queueTimestamp ?? '\uffff';
    if (aTs !== bTs) return aTs < bTs ? -1 : 1;
    if (a.normalizedRepositoryIdentity !== b.normalizedRepositoryIdentity)
      return a.normalizedRepositoryIdentity < b.normalizedRepositoryIdentity ? -1 : 1;
    return a.prNumber - b.prNumber;
  });

  return needsAdvice.slice(0, config.maxCandidatesPerInvocation).map(item => ({
    repositoryKey: item.repositoryKey,
    prNumber: item.prNumber,
    headSha: item.headSha,
    baseSha: item.baseSha,
    title: item.title,
    author: item.author,
    draft: item.draft,
    labels: item.labels.slice(0, 50),
    additions: item.additions,
    deletions: item.deletions,
    changedFiles: item.changedFiles.slice(0, 500),
    reviewRequested: item.reviewRequested,
    checkSummary: item.checkSummary.slice(0, 100),
    updatedAt: item.updatedAt,
    bodyTruncated: item.bodyTruncated.slice(0, 8192),
    selectionReason: !item.hasCurrentAdvice
      ? 'never_advised'
      : item.adviceStale
        ? 'stale_changed'
        : 'previously_not_scheduled',
  }));
}
