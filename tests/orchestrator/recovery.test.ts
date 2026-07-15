import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { recoverOrphanedStates } from "../../src/orchestrator/recovery.js";
import { runMigrations } from "../../src/store/migrate.js";

function insertJob(
  db: Database.Database,
  row: { id: string; state: string; version: number },
): void {
  db.prepare(
    `INSERT INTO jobs (
      id, identity_hash, repository_key, pr_number, head_sha, source_mode,
      policy_hash, state, version
    ) VALUES (?, ?, 'repo', 1, 'a', 'registered-source', 'p', ?, ?)`,
  ).run(row.id, `id-${row.id}`, row.state, row.version);
}

function insertRun(
  db: Database.Database,
  row: { id: string; state: string; version: number; jobId?: string },
): void {
  const jobId = row.jobId ?? "job-for-run";
  if (!db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId)) {
    insertJob(db, { id: jobId, state: "published", version: 1 });
  }
  db.prepare(
    `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version)
     VALUES (?, ?, 1, 'rih', ?, ?)`,
  ).run(row.id, jobId, row.state, row.version);
}

describe("recoverOrphanedStates", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("keeps queued jobs as queued", () => {
    insertJob(db, { id: "j1", state: "queued", version: 1 });
    const result = recoverOrphanedStates(db);
    expect(result.failedJobs).toHaveLength(0);
    const row = db
      .prepare("SELECT state FROM jobs WHERE id = ?")
      .get("j1") as { state: string };
    expect(row.state).toBe("queued");
  });

  it("fails orphaned running_agent jobs with daemon_restart", () => {
    insertJob(db, { id: "j1", state: "running_agent", version: 3 });
    const result = recoverOrphanedStates(db);
    expect(result.failedJobs).toContain("j1");
    expect(result.failureReasons.get("j1")).toBe("daemon_restart");
  });

  it("fails orphaned preparing_source and preparing_context jobs", () => {
    insertJob(db, { id: "j-src", state: "preparing_source", version: 2 });
    insertJob(db, { id: "j-ctx", state: "preparing_context", version: 1 });
    const result = recoverOrphanedStates(db);
    expect(result.failedJobs).toEqual(
      expect.arrayContaining(["j-src", "j-ctx"]),
    );
    expect(result.failureReasons.get("j-src")).toBe("daemon_restart");
    expect(result.failureReasons.get("j-ctx")).toBe("daemon_restart");
  });

  it("fails orphaned running/validating runs", () => {
    insertRun(db, { id: "r1", state: "running", version: 2 });
    const result = recoverOrphanedStates(db);
    expect(result.failedRuns).toContain("r1");
  });

  it("does not fail terminal jobs", () => {
    insertJob(db, { id: "j1", state: "published", version: 5 });
    const result = recoverOrphanedStates(db);
    expect(result.failedJobs).toHaveLength(0);
  });

  it("does not retry orphaned runs automatically", () => {
    insertRun(db, { id: "r1", state: "running", version: 2 });
    const result = recoverOrphanedStates(db);
    expect(result.autoRetried).toHaveLength(0);
  });
});
