import type { TrackedQueueRow } from "./api.js";

export type InboxChip =
  | "needs-analysis"
  | "analyzing"
  | "ready"
  | "waiting"
  | "failed";

export type InboxAction = "analyze" | "open-review" | "retry" | null;

export type CoverageFilter = "eligible" | "ineligible" | "all";

const RELEVANCE_ORDINAL: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

const RISK_ORDINAL: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

const ACTIVE_JOB_STATES = new Set([
  "queued",
  "preparing_context",
  "preparing_source",
  "running_agent",
  "validating_output",
]);

const REVIEWABLE_JOB_STATES = new Set([
  "draft_ready",
  "awaiting_approval",
  "publishing",
]);

export function isEligible(item: TrackedQueueRow): boolean {
  return item.priority !== "unranked" && item.exclusionReasons.length === 0;
}

export function deriveInboxPresentation(item: TrackedQueueRow): {
  chip: InboxChip;
  primaryAction: InboxAction;
} {
  if (item.jobState === "failed") {
    return { chip: "failed", primaryAction: "retry" };
  }

  if (item.jobState !== null && REVIEWABLE_JOB_STATES.has(item.jobState)) {
    return { chip: "ready", primaryAction: "open-review" };
  }

  if (item.jobState !== null && ACTIVE_JOB_STATES.has(item.jobState)) {
    return { chip: "analyzing", primaryAction: null };
  }

  if (isEligible(item)) {
    return { chip: "needs-analysis", primaryAction: "analyze" };
  }

  return { chip: "waiting", primaryAction: null };
}

function hasCurrentAdvice(item: TrackedQueueRow): boolean {
  return item.advisorResult !== null && !item.advisorResult.stale;
}

function compareQueueOrder(a: TrackedQueueRow, b: TrackedQueueRow): number {
  const ao = a.queueOrder;
  const bo = b.queueOrder;

  if (ao.prioritySortOrdinal !== bo.prioritySortOrdinal) {
    return ao.prioritySortOrdinal - bo.prioritySortOrdinal;
  }
  if (ao.explicitRequestSort !== bo.explicitRequestSort) {
    return ao.explicitRequestSort - bo.explicitRequestSort;
  }
  if (ao.queueTimestamp !== bo.queueTimestamp) {
    return ao.queueTimestamp < bo.queueTimestamp ? -1 : 1;
  }
  if (ao.normalizedRepositoryIdentity !== bo.normalizedRepositoryIdentity) {
    return ao.normalizedRepositoryIdentity < bo.normalizedRepositoryIdentity
      ? -1
      : 1;
  }
  return ao.prNumber - bo.prNumber;
}

function compareAdvisedRows(a: TrackedQueueRow, b: TrackedQueueRow): number {
  const ar = a.advisorResult!;
  const br = b.advisorResult!;

  const relA = RELEVANCE_ORDINAL[ar.relevance] ?? 4;
  const relB = RELEVANCE_ORDINAL[br.relevance] ?? 4;
  if (relA !== relB) return relA - relB;

  const riskA = RISK_ORDINAL[ar.risk] ?? 4;
  const riskB = RISK_ORDINAL[br.risk] ?? 4;
  if (riskA !== riskB) return riskA - riskB;

  return compareQueueOrder(a, b);
}

export function sortInboxRows(items: TrackedQueueRow[]): TrackedQueueRow[] {
  const advised = items.filter(hasCurrentAdvice);
  const nonAdvised = items.filter((item) => !hasCurrentAdvice(item));

  const sortedAdvised = [...advised].sort(compareAdvisedRows);
  const sortedNonAdvised = [...nonAdvised].sort(compareQueueOrder);

  return [...sortedAdvised, ...sortedNonAdvised];
}

function formatReasonCode(code: string): string {
  return code.replaceAll("_", " ");
}

export function summarizeReasons(item: TrackedQueueRow): string {
  const reasons =
    item.eligibilityReasons.length > 0
      ? item.eligibilityReasons
      : item.exclusionReasons;

  if (reasons.length === 0) {
    return "No eligibility reason recorded";
  }

  const first = reasons[0]!;
  if (first.code === "explicit_review_request") {
    return "explicit review request";
  }
  if (first.code === "eligible_author") {
    return "eligible author";
  }
  if (first.code === "eligible_path") {
    const matchedPath = first.matchedPath;
    if (typeof matchedPath === "string") {
      return `eligible path · ${matchedPath}`;
    }
    return "eligible path · matched path";
  }

  return formatReasonCode(first.code);
}

export function filterCoverageRows(
  items: TrackedQueueRow[],
  filter: CoverageFilter,
  query: string,
): TrackedQueueRow[] {
  const normalizedQuery = query.trim().toLowerCase();

  return items.filter((item) => {
    if (filter === "eligible" && !isEligible(item)) return false;
    if (filter === "ineligible" && isEligible(item)) return false;

    if (normalizedQuery.length === 0) return true;

    const haystack = [
      `${item.repository}#${item.prNumber}`,
      item.title,
      item.author,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}
