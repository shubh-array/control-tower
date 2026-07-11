import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { transitionJob } from "./transitions.js";
import type { JobState } from "./job-state.js";

export function createRetryAttempt(db: Database.Database, jobId: string): string {
  const job = db
    .prepare(
      `SELECT id, state, version FROM jobs WHERE id = ?`,
    )
    .get(jobId) as
    | {
        id: string;
        state: JobState;
        version: number;
      }
    | undefined;

  if (!job) {
    throw new Error(`createRetryAttempt: job not found: ${jobId}`);
  }
  if (job.state !== "failed") {
    throw new Error(
      `createRetryAttempt: job ${jobId} is ${job.state}, expected failed`,
    );
  }

  transitionJob(db, {
    jobId,
    expectedState: "failed",
    expectedVersion: job.version,
    newState: "queued",
    manualRetry: true,
    failureReason: undefined,
  });

  const maxAttempt =
    (
      db
        .prepare(
          `SELECT MAX(attempt_number) as n FROM runs WHERE job_id = ?`,
        )
        .get(jobId) as { n: number | null }
    ).n ?? 0;

  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version, started_at)
     VALUES (?, ?, ?, ?, 'allocated', 1, ?)`,
  ).run(runId, jobId, maxAttempt + 1, `retry-${jobId}`, now);

  db.prepare(
    `UPDATE jobs SET latest_run_id = ?, accepted_run_id = NULL, updated_at = ? WHERE id = ?`,
  ).run(runId, now, jobId);

  return runId;
}
