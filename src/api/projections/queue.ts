import type Database from "better-sqlite3";
import type { AllTrackedItem } from "../../policy/evaluate.js";
import { toQueueTuple } from "../../policy/queue-order.js";
import type {
  AdvisorResult,
  FocusQueueRow,
  TrackedQueueRow,
} from "../contracts.js";

interface AttentionEnrichment {
  state: string;
  advisor_relevance: string | null;
  advisor_risk: string | null;
  advisor_status: string | null;
  created_at: string;
}

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

function buildAdvisorResult(row: AttentionEnrichment | undefined): AdvisorResult | null {
  if (!row?.advisor_relevance || !row.advisor_risk) {
    return null;
  }
  return {
    relevance: row.advisor_relevance,
    risk: row.advisor_risk,
    explanation: "",
    recommendedAction: "monitor",
    confidence: "medium",
    unknowns: [],
    stale: row.advisor_status === "stale",
  };
}

export function loadQueueEnrichment(db: Database.Database): {
  attention: Map<string, AttentionEnrichment>;
  jobs: Map<string, JobEnrichment>;
  repositoryDisplay: Map<string, string>;
} {
  const attention = new Map<string, AttentionEnrichment>();
  for (const row of db
    .prepare(
      `SELECT repository_key, pr_number, state, advisor_relevance, advisor_risk,
              advisor_status, created_at
       FROM attention_items`,
    )
    .all() as Array<
      AttentionEnrichment & { repository_key: string; pr_number: number }
    >) {
    attention.set(prKey(row.repository_key, row.pr_number), row);
  }

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

  return { attention, jobs, repositoryDisplay };
}

export function projectTrackedItem(
  item: AllTrackedItem,
  enrichment: ReturnType<typeof loadQueueEnrichment>,
): TrackedQueueRow {
  const key = prKey(item.repositoryKey, item.prNumber);
  const att = enrichment.attention.get(key);
  const job = enrichment.jobs.get(key);
  const repo =
    enrichment.repositoryDisplay.get(item.repositoryKey) ?? item.repositoryKey;

  const { queueTimestampSort, ...tupleRest } = toQueueTuple({
    prNumber: item.prNumber,
    normalizedRepositoryIdentity: item.repositoryKey,
    prioritySortOrdinal: item.policy.prioritySortOrdinal,
    explicitRequest: item.reviewRequested,
    explicitRequestTimestamp: item.explicitRequestTimestamp ?? undefined,
    updatedAt: item.updatedAt ?? "unknown",
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
    author: item.author,
    headSha: item.headSha,
    eligibilityReasons: item.policy.eligibilityReasons as unknown as TrackedQueueRow["eligibilityReasons"],
    exclusionReasons: item.policy.exclusionReasons as unknown as TrackedQueueRow["exclusionReasons"],
    priority: item.policy.priorityStatus,
    priorityReasons: item.policy.priorityReasons as unknown as TrackedQueueRow["priorityReasons"],
    queueOrder,
    domains: item.policy.selectedDomains.map((d) => d.domain),
    attentionState: att?.state ?? "monitoring",
    jobState: job?.state ?? null,
    advisorResult: buildAdvisorResult(att),
    discoveredAt: att?.created_at ?? item.updatedAt ?? new Date().toISOString(),
    updatedAt: item.updatedAt ?? new Date().toISOString(),
  };
}

export function projectAllTracked(
  db: Database.Database,
  items: AllTrackedItem[],
): TrackedQueueRow[] {
  const enrichment = loadQueueEnrichment(db);
  for (const item of items) {
    if (!enrichment.repositoryDisplay.has(item.repositoryKey)) {
      enrichment.repositoryDisplay.set(
        item.repositoryKey,
        resolveRepositoryDisplay(db, item.repositoryKey),
      );
    }
  }
  return items.map((item) => projectTrackedItem(item, enrichment));
}

export function projectFocusQueue(
  db: Database.Database,
  focus: {
    now: AllTrackedItem[];
    next: AllTrackedItem[];
    monitor: AllTrackedItem[];
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
    now: focus.now.map((i) => projectTrackedItem(i, enrichment)),
    next: focus.next.map((i) => projectTrackedItem(i, enrichment)),
    monitor: focus.monitor.map((i) => projectTrackedItem(i, enrichment)),
  };
}
