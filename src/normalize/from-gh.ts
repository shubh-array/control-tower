import type {
  DiscoveredPr,
  GhCheckRun,
  GhPrListItem,
  GhPrViewResult,
  GhSearchPrItem,
} from "../github/types.js";

type GhPrRaw = GhSearchPrItem | GhPrListItem | GhPrViewResult;

function isSearchItem(raw: GhPrRaw): raw is GhSearchPrItem {
  return "repository" in raw;
}

function isViewResult(raw: GhPrRaw): raw is GhPrViewResult {
  return "files" in raw;
}

function isListItem(raw: GhPrRaw): raw is GhPrListItem {
  return "headRefName" in raw;
}

function githubOwnerRepo(raw: GhPrRaw): string {
  if (isSearchItem(raw)) {
    return raw.repository.nameWithOwner;
  }

  const urlMatch = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(raw.url);
  if (urlMatch) {
    return urlMatch[1]!;
  }

  throw new Error("githubOwnerRepo requires GhSearchPrItem or PR URL with owner/repo");
}

function resolveGithubOwnerRepo(
  raw: GhPrRaw,
  repositoryId: string,
): string {
  if (isSearchItem(raw)) {
    return raw.repository.nameWithOwner;
  }

  const syntheticMatch = /^github:[^/]+\/(.+\/.+)$/.exec(repositoryId);
  if (syntheticMatch) {
    return syntheticMatch[1]!;
  }

  const urlMatch = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(raw.url);
  if (urlMatch) {
    return urlMatch[1]!;
  }

  throw new Error(
    `Cannot resolve githubOwnerRepo for repositoryId "${repositoryId}"`,
  );
}

function mapReviewRequests(
  requests: Array<{ login?: string; slug?: string }>,
): DiscoveredPr["reviewRequests"] {
  return requests
    .map((request) => request.login ?? request.slug)
    .filter((login): login is string => Boolean(login))
    .map((login) => ({ login }));
}

function mapChecks(raw: GhPrRaw): GhCheckRun[] {
  if (isListItem(raw) || isViewResult(raw)) {
    return raw.statusCheckRollup ?? [];
  }
  return [];
}

function mapChangedFiles(raw: GhPrRaw): string[] {
  if (isViewResult(raw)) {
    return raw.files.map((file) => file.path);
  }
  return [];
}

function mapReviews(raw: GhPrRaw): DiscoveredPr["reviews"] {
  if (!isViewResult(raw)) {
    return [];
  }

  return raw.reviews.map((review) => ({
    authorLogin: review.author.login,
    state: review.state,
    body: review.body,
    submittedAt: review.submittedAt,
  }));
}

function mapComments(raw: GhPrRaw): DiscoveredPr["comments"] {
  if (!isViewResult(raw)) {
    return [];
  }

  return raw.comments.map((comment) => ({
    authorLogin: comment.author.login,
    body: comment.body,
    createdAt: comment.createdAt,
    url: comment.url,
  }));
}

export function toDiscoveredPr(
  raw: GhPrRaw,
  repositoryId: string,
  explicitRequest: boolean,
): DiscoveredPr {
  const ownerRepo = isSearchItem(raw)
    ? githubOwnerRepo(raw)
    : resolveGithubOwnerRepo(raw, repositoryId);

  const discovered: DiscoveredPr = {
    repositoryId,
    githubOwnerRepo: ownerRepo,
    prNumber: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    authorLogin: raw.author.login,
    headSha: raw.headRefOid,
    baseSha: raw.baseRefOid,
    labels: raw.labels.map((label) => label.name),
    additions: raw.additions,
    deletions: raw.deletions,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    changedFiles: mapChangedFiles(raw),
    unsafeFiles: [],
    reviewRequests: mapReviewRequests(raw.reviewRequests),
    checks: mapChecks(raw),
    reviews: mapReviews(raw),
    comments: mapComments(raw),
    explicitRequest,
  };

  if (isListItem(raw) || isViewResult(raw)) {
    discovered.headRef = raw.headRefName;
    discovered.baseRef = raw.baseRefName;
  }

  if (isViewResult(raw)) {
    discovered.body = raw.body;
  }

  if (explicitRequest) {
    discovered.explicitRequestTimestamp = raw.updatedAt;
  }

  return discovered;
}
