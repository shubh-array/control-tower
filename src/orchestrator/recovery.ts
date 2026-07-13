import type Database from "better-sqlite3";

export interface RecoveryResult {
  failedJobs: string[];
  failedRuns: string[];
  autoRetried: string[];
  failureReasons: Map<string, string>;
  publishingReconciled: string[];
}

function hasPublicationOperationsTable(db: Database.Database): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'publication_operations'",
    )
    .get() as { name: string } | undefined;
  return row !== undefined;
}

export function recoverOrphanedStates(db: Database.Database): RecoveryResult {
  const result: RecoveryResult = {
    failedJobs: [],
    failedRuns: [],
    autoRetried: [],
    failureReasons: new Map(),
    publishingReconciled: [],
  };

  db.transaction(() => {
    const now = new Date().toISOString();

    const orphanedAgentJobs = db
      .prepare("SELECT id, version FROM jobs WHERE state = 'running_agent'")
      .all() as Array<{ id: string; version: number }>;
    for (const job of orphanedAgentJobs) {
      db.prepare(
        `UPDATE jobs SET state = 'failed', version = version + 1, failure_reason = 'daemon_restart', updated_at = ? WHERE id = ? AND version = ?`,
      ).run(now, job.id, job.version);
      result.failedJobs.push(job.id);
      result.failureReasons.set(job.id, "daemon_restart");
    }

    const orphanedValidatingJobs = db
      .prepare("SELECT id, version FROM jobs WHERE state = 'validating_output'")
      .all() as Array<{ id: string; version: number }>;
    for (const job of orphanedValidatingJobs) {
      db.prepare(
        `UPDATE jobs SET state = 'failed', version = version + 1, failure_reason = 'daemon_restart', updated_at = ? WHERE id = ? AND version = ?`,
      ).run(now, job.id, job.version);
      result.failedJobs.push(job.id);
      result.failureReasons.set(job.id, "daemon_restart");
    }

    const orphanedRuns = db
      .prepare(
        "SELECT id, version, state FROM runs WHERE state IN ('running', 'validating')",
      )
      .all() as Array<{ id: string; version: number; state: string }>;
    for (const run of orphanedRuns) {
      db.prepare(
        `UPDATE runs SET state = 'failed', version = version + 1, failure_reason = 'daemon_restart' WHERE id = ? AND version = ?`,
      ).run(run.id, run.version);
      result.failedRuns.push(run.id);
    }

    if (hasPublicationOperationsTable(db)) {
      const publishingJobs = db
        .prepare("SELECT id, version FROM jobs WHERE state = 'publishing'")
        .all() as Array<{ id: string; version: number }>;
      for (const job of publishingJobs) {
        const allOpsComplete = db
          .prepare(
            "SELECT COUNT(*) as cnt FROM publication_operations WHERE job_id = ? AND status != 'completed'",
          )
          .get(job.id) as { cnt: number } | undefined;
        if (allOpsComplete && allOpsComplete.cnt === 0) {
          db.prepare(
            "UPDATE jobs SET state = 'published', version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
          ).run(now, job.id, job.version);
          result.publishingReconciled.push(job.id);
        } else {
          db.prepare(
            `UPDATE jobs SET state = 'awaiting_approval', version = version + 1, failure_reason = 'daemon_restart_partial_publish', updated_at = ? WHERE id = ? AND version = ?`,
          ).run(now, job.id, job.version);
          result.failedJobs.push(job.id);
          result.failureReasons.set(job.id, "daemon_restart_partial_publish");
        }
      }
    }
  })();

  return result;
}
