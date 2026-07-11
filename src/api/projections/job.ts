import type Database from "better-sqlite3";
import type { JobDetail, RunSummary } from "../contracts.js";

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
  return repositoryKey;
}

export function loadJobDetail(
  db: Database.Database,
  jobId: string,
): JobDetail | null {
  const job = db
    .prepare(
      `SELECT id, repository_key, pr_number, head_sha, state, source_mode,
              accepted_run_id
       FROM jobs WHERE id = ?`,
    )
    .get(jobId) as
    | {
        id: string;
        repository_key: string;
        pr_number: number;
        head_sha: string;
        state: string;
        source_mode: string;
        accepted_run_id: string | null;
      }
    | undefined;

  if (!job) return null;

  const runs = db
    .prepare(
      `SELECT id, attempt_number, state, started_at, sealed_at
       FROM runs WHERE job_id = ? ORDER BY attempt_number`,
    )
    .all(jobId) as Array<{
    id: string;
    attempt_number: number;
    state: string;
    started_at: string | null;
    sealed_at: string | null;
  }>;

  const runSummaries: RunSummary[] = runs.map((r) => ({
    runId: r.id,
    attemptNumber: r.attempt_number,
    state: r.state,
    startedAt: r.started_at ?? new Date().toISOString(),
    completedAt: r.sealed_at,
  }));

  return {
    jobId: job.id,
    repository: resolveRepositoryDisplay(db, job.repository_key),
    prNumber: job.pr_number,
    headSha: job.head_sha,
    state: job.state,
    sourceMode: job.source_mode,
    runs: runSummaries,
    acceptedRunId: job.accepted_run_id,
  };
}
