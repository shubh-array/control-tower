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

  db.prepare(
    `UPDATE jobs SET accepted_run_id = NULL, updated_at = ? WHERE id = ?`,
  ).run(new Date().toISOString(), jobId);

  return jobId;
}
