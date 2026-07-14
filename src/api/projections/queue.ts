import type Database from "better-sqlite3";
import type { ReviewQueueItem } from "../../policy/evaluate.js";
import { toQueueTuple } from "../../policy/queue-order.js";
import type { FocusQueueRow, ReviewQueueRow } from "../contracts.js";

interface JobEnrichment {
  id: string;
  state: string;
}

function prKey(repositoryKey: string, prNumber: number): string {
  return `${repositoryKey}#${prNumber}`;
}

function resolveRepositoryDisplay(
  db: Database.Database,
  repositoryKey: string,
): string {
  const row = db
    .prepare(
      `SELECT github_owner, github_repo FROM repositories WHERE id = ?`,
    )
    .get(repositoryKey) as
    | { github_owner: string; github_repo: string }
    | undefined;
  if (row) {
    return `${row.github_owner}/${row.github_repo}`;
  }
  if (repositoryKey.startsWith("github:")) {
    const parts = repositoryKey.split("/");
    if (parts.length >= 3) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  }
  return repositoryKey;
}

export function loadQueueEnrichment(db: Database.Database): {
  jobs: Map<string, JobEnrichment>;
  repositoryDisplay: Map<string, string>;
} {
  const jobs = new Map<string, JobEnrichment>();
  for (const row of db
    .prepare(
      `SELECT id, repository_key, pr_number, state
       FROM jobs
       WHERE state NOT IN ('superseded', 'cancelled', 'published')
       ORDER BY updated_at DESC`,
    )
    .all() as Array<
      JobEnrichment & { repository_key: string; pr_number: number }
    >) {
    const key = prKey(row.repository_key, row.pr_number);
    if (!jobs.has(key)) {
      jobs.set(key, { id: row.id, state: row.state });
    }
  }

  const repositoryDisplay = new Map<string, string>();
  for (const row of db
    .prepare(`SELECT id FROM repositories`)
    .all() as Array<{ id: string }>) {
    repositoryDisplay.set(row.id, resolveRepositoryDisplay(db, row.id));
  }

  return { jobs, repositoryDisplay };
}

export function projectReviewQueueItem(
  item: ReviewQueueItem,
  enrichment: ReturnType<typeof loadQueueEnrichment>,
): ReviewQueueRow {
  const key = prKey(item.repositoryKey, item.prNumber);
  const job = enrichment.jobs.get(key);
  const repo =
    enrichment.repositoryDisplay.get(item.repositoryKey) ?? item.repositoryKey;

  const { queueTimestampSort, ...tupleRest } = toQueueTuple({
    prNumber: item.prNumber,
    normalizedRepositoryIdentity: item.repositoryKey,
    prioritySortOrdinal: item.policy.prioritySortOrdinal,
    explicitRequest: item.explicitRequest,
    explicitRequestTimestamp: item.explicitRequestTimestamp ?? undefined,
    updatedAt: item.updatedAt || "unknown",
    eligible: item.policy.eligible,
  });
  const queueOrder = {
    ...tupleRest,
    queueTimestamp: queueTimestampSort,
  };

  return {
    jobId: job?.id ?? null,
    repositoryKey: item.repositoryKey,
    repository: repo,
    prNumber: item.prNumber,
    title: item.title,
    url: item.url,
    author: item.author,
    headSha: item.headSha,
    eligibilityReasons: item.policy.eligibilityReasons as unknown as ReviewQueueRow["eligibilityReasons"],
    priority: item.policy.priorityStatus as ReviewQueueRow["priority"],
    priorityReasons: item.policy.priorityReasons as unknown as ReviewQueueRow["priorityReasons"],
    queueOrder,
    domains: item.policy.selectedDomains.map((d) => d.domain),
    jobState: job?.state ?? null,
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

export function projectFocusQueue(
  db: Database.Database,
  focus: {
    now: ReviewQueueItem[];
    next: ReviewQueueItem[];
    monitor: ReviewQueueItem[];
  },
): { now: FocusQueueRow[]; next: FocusQueueRow[]; monitor: FocusQueueRow[] } {
  const enrichment = loadQueueEnrichment(db);
  for (const item of [...focus.now, ...focus.next, ...focus.monitor]) {
    if (!enrichment.repositoryDisplay.has(item.repositoryKey)) {
      enrichment.repositoryDisplay.set(
        item.repositoryKey,
        resolveRepositoryDisplay(db, item.repositoryKey),
      );
    }
  }
  return {
    now: focus.now.map((i) => projectReviewQueueItem(i, enrichment)),
    next: focus.next.map((i) => projectReviewQueueItem(i, enrichment)),
    monitor: focus.monitor.map((i) => projectReviewQueueItem(i, enrichment)),
  };
}
