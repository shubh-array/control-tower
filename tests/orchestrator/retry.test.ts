import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { createRetryAttempt } from "../../src/orchestrator/retry.js";

describe("createRetryAttempt", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ct-retry-"));
    db = openDatabase(join(tmp, "test.sqlite"));
    runMigrations(db);
    db.prepare(
      `INSERT INTO jobs (
         id, identity_hash, repository_key, pr_number, head_sha, source_mode,
         policy_hash, state, version, latest_run_id, accepted_run_id, queued_at
       ) VALUES (
         'job-fail', 'hash-fail', 'pba-webapp', 7, ?, 'registered-source', 'ph',
         'failed', 2, 'run-1', 'run-1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
       )`,
    ).run("c".repeat(40));
    db.prepare(
      `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version)
       VALUES ('run-1', 'job-fail', 1, 'input-1', 'failed', 1)`,
    ).run();
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("requeues failed job, creates no new runs, clears accepted pointer, and returns job id", () => {
    const returnedJobId = createRetryAttempt(db, "job-fail");
    expect(returnedJobId).toBe("job-fail");

    const job = db
      .prepare(
        `SELECT state, accepted_run_id, latest_run_id FROM jobs WHERE id = 'job-fail'`,
      )
      .get() as {
      state: string;
      accepted_run_id: string | null;
      latest_run_id: string | null;
    };
    expect(job.state).toBe("queued");
    expect(job.accepted_run_id).toBeNull();
    expect(job.latest_run_id).toBe("run-1");

    const runs = db
      .prepare(`SELECT COUNT(*) as cnt FROM runs WHERE job_id = 'job-fail'`)
      .get() as { cnt: number };
    expect(runs.cnt).toBe(1);
  });

  it("rejects retry for non-failed job", () => {
    db.prepare(`UPDATE jobs SET state = 'queued' WHERE id = 'job-fail'`).run();
    expect(() => createRetryAttempt(db, "job-fail")).toThrow(/expected failed/);
  });
});
