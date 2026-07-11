import type Database from "better-sqlite3";

export interface SchedulerConfig {
  maxConcurrentAgents: number;
  debounceMs: number;
}

interface QueuedJob {
  id: string;
  repositoryKey: string;
  prNumber: number;
  prioritySortOrdinal: number;
  explicitRequestSort: number;
  queueTimestamp: string | null;
  normalizedRepositoryIdentity: string;
  identityHash: string;
  queuedAt: string;
}

export interface SchedulerDecision {
  jobsToStart: string[];
  reason: string;
}

export function selectNextJobs(
  db: Database.Database,
  config: SchedulerConfig,
): SchedulerDecision {
  const activeCount =
    (
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM jobs WHERE state IN ('preparing_context','preparing_source','running_agent','validating_output')`,
        )
        .get() as { cnt: number } | undefined
    )?.cnt ?? 0;

  const slotsAvailable = Math.max(0, config.maxConcurrentAgents - activeCount);
  if (slotsAvailable === 0) {
    return { jobsToStart: [], reason: "no_slots_available" };
  }

  const activePRs = new Set(
    (
      db
        .prepare(
          `SELECT identity_hash FROM jobs WHERE state IN ('preparing_context','preparing_source','running_agent','validating_output')`,
        )
        .all() as Array<{ identity_hash: string }>
    ).map((r) => r.identity_hash),
  );

  const candidates = db
    .prepare(
      `SELECT id, repository_key as repositoryKey, pr_number as prNumber,
              priority_sort_ordinal as prioritySortOrdinal,
              explicit_request_sort as explicitRequestSort,
              queue_timestamp as queueTimestamp,
              repository_key as normalizedRepositoryIdentity,
              identity_hash as identityHash,
              queued_at as queuedAt
       FROM jobs WHERE state = 'queued'
       ORDER BY priority_sort_ordinal ASC,
                explicit_request_sort ASC,
                queue_timestamp ASC NULLS LAST,
                repository_key ASC,
                pr_number ASC`,
    )
    .all() as QueuedJob[];

  const now = Date.now();
  const jobsToStart: string[] = [];

  for (const candidate of candidates) {
    if (jobsToStart.length >= slotsAvailable) break;

    if (activePRs.has(candidate.identityHash)) continue;

    if (now - new Date(candidate.queuedAt).getTime() < config.debounceMs) {
      continue;
    }

    jobsToStart.push(candidate.id);
    activePRs.add(candidate.identityHash);
  }

  return {
    jobsToStart,
    reason:
      jobsToStart.length > 0 ? "jobs_selected" : "no_eligible_candidates",
  };
}
