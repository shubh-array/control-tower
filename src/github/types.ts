// --- gh CLI JSON response shapes ---

export interface GhSearchPrItem {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: { login: string };
  repository: { nameWithOwner: string; name?: string };
  labels: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  /** Not returned by `gh search prs --json`; filled via enrich/view. */
  headRefOid?: string;
  baseRefOid?: string;
  additions?: number;
  deletions?: number;
  reviewRequests?: Array<{ login?: string; slug?: string; __typename?: string }>;
}

export interface GhPrListItem {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: { login: string };
  headRefOid: string;
  baseRefOid: string;
  headRefName: string;
  baseRefName: string;
  labels: Array<{ name: string }>;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  reviewRequests: Array<{ login?: string; slug?: string; __typename?: string }>;
  statusCheckRollup: GhCheckRun[] | null;
}

export interface GhPrViewResult extends GhPrListItem {
  body: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  reviews: Array<{
    author: { login: string };
    state: string;
    body: string;
    submittedAt: string;
  }>;
  comments: Array<{
    author: { login: string };
    body: string;
    createdAt: string;
    url: string;
  }>;
  commits: Array<{
    oid: string;
    messageHeadline: string;
    authors: Array<{ login?: string }>;
  }>;
}

export interface GhCheckRun {
  __typename: string;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
}

export interface GhRateLimit {
  resources: {
    core: GhRateLimitResource;
    search: GhRateLimitResource;
    graphql: GhRateLimitResource;
  };
}

export interface GhRateLimitResource {
  limit: number;
  remaining: number;
  reset: number;
}

// --- Internal discovery types ---

export interface DiscoveredPr {
  repositoryId: string;
  githubOwnerRepo: string;
  prNumber: number;
  title: string;
  body?: string;
  url: string;
  state: string;
  isDraft: boolean;
  authorLogin: string;
  headSha: string;
  baseSha: string;
  headRef?: string;
  baseRef?: string;
  labels: string[];
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  changedFiles: string[];
  unsafeFiles: Array<{ raw: string; diagnostic: string }>;
  reviewRequests: Array<{ login: string; requestedAt?: string }>;
  checks: GhCheckRun[];
  reviews: Array<{
    authorLogin: string;
    state: string;
    body: string;
    submittedAt: string;
  }>;
  comments: Array<{
    authorLogin: string;
    body: string;
    createdAt: string;
    url: string;
  }>;
  explicitRequest: boolean;
  explicitRequestTimestamp?: string;
}

export interface HostHealth {
  host: string;
  healthy: boolean;
  authenticatedLogin: string | null;
  error?: string;
  checkedAt: string;
}

export type PriorityTier = 'p0' | 'p1' | 'p2' | 'p3';
export type PriorityStatus = PriorityTier | 'unranked';

export const PRIORITY_TIERS: readonly PriorityTier[] = ['p0', 'p1', 'p2', 'p3'];

export const PRIORITY_SORT_ORDINALS: Record<PriorityStatus, number> = {
  p0: 0, p1: 1, p2: 2, p3: 3, unranked: 4,
};

export type AnalysisMode = 'auto' | 'on_demand';
