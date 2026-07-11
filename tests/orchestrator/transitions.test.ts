import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  transitionJob,
  transitionRun,
  TransitionError,
} from "../../src/orchestrator/transitions.js";
import { runMigrations } from "../../src/store/migrate.js";

function insertJob(
  db: Database.Database,
  row: {
    id: string;
    state: string;
    version: number;
    identityHash?: string;
  },
): void {
  db.prepare(
    `INSERT INTO jobs (
      id, identity_hash, repository_key, pr_number, head_sha, source_mode,
      policy_hash, state, version
    ) VALUES (?, ?, 'repo', 1, 'a', 'registered-source', 'p', ?, ?)`,
  ).run(row.id, row.identityHash ?? `id-${row.id}`, row.state, row.version);
}

function insertRun(
  db: Database.Database,
  row: { id: string; state: string; version: number; jobId?: string },
): void {
  const jobId = row.jobId ?? "job-for-run";
  if (
    !db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId)
  ) {
    insertJob(db, { id: jobId, state: "published", version: 1 });
  }
  db.prepare(
    `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version)
     VALUES (?, ?, 1, 'rih', ?, ?)`,
  ).run(row.id, jobId, row.state, row.version);
}

describe("transitionJob", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("allows queued -> preparing_context", () => {
    insertJob(db, { id: "job-1", state: "queued", version: 1 });
    const result = transitionJob(db, {
      jobId: "job-1",
      expectedState: "queued",
      expectedVersion: 1,
      newState: "preparing_context",
    });
    expect(result.success).toBe(true);
  });

  it("rejects illegal transition queued -> running_agent", () => {
    insertJob(db, { id: "job-1", state: "queued", version: 1 });
    expect(() =>
      transitionJob(db, {
        jobId: "job-1",
        expectedState: "queued",
        expectedVersion: 1,
        newState: "running_agent",
      }),
    ).toThrow(TransitionError);
  });

  it("rejects transition when current state does not match expected", () => {
    insertJob(db, {
      id: "job-1",
      state: "preparing_context",
      version: 2,
    });
    expect(() =>
      transitionJob(db, {
        jobId: "job-1",
        expectedState: "queued",
        expectedVersion: 2,
        newState: "preparing_context",
      }),
    ).toThrow(TransitionError);
  });

  it("rejects transition when version does not match", () => {
    insertJob(db, { id: "job-1", state: "queued", version: 3 });
    expect(() =>
      transitionJob(db, {
        jobId: "job-1",
        expectedState: "queued",
        expectedVersion: 1,
        newState: "preparing_context",
      }),
    ).toThrow(TransitionError);
  });

  it("terminal states cannot transition", () => {
    insertJob(db, { id: "job-1", state: "published", version: 1 });
    expect(() =>
      transitionJob(db, {
        jobId: "job-1",
        expectedState: "published",
        expectedVersion: 1,
        newState: "queued",
      }),
    ).toThrow(TransitionError);
  });

  it("failed -> queued requires manualRetry flag", () => {
    insertJob(db, { id: "job-1", state: "failed", version: 5 });
    expect(() =>
      transitionJob(db, {
        jobId: "job-1",
        expectedState: "failed",
        expectedVersion: 5,
        newState: "queued",
      }),
    ).toThrow(TransitionError);

    const result = transitionJob(db, {
      jobId: "job-1",
      expectedState: "failed",
      expectedVersion: 5,
      newState: "queued",
      manualRetry: true,
    });
    expect(result.success).toBe(true);
  });

  it("preparing_context -> running_agent allowed for remote-evidence-only", () => {
    insertJob(db, {
      id: "job-1",
      state: "preparing_context",
      version: 1,
    });
    const result = transitionJob(db, {
      jobId: "job-1",
      expectedState: "preparing_context",
      expectedVersion: 1,
      newState: "running_agent",
    });
    expect(result.success).toBe(true);
  });

  it("duplicate event on same version is idempotent no-op", () => {
    insertJob(db, {
      id: "job-1",
      state: "preparing_context",
      version: 2,
    });
    const result = transitionJob(db, {
      jobId: "job-1",
      expectedState: "preparing_context",
      expectedVersion: 2,
      newState: "preparing_context",
      idempotencyKey: "evt-1",
    });
    expect(result.success).toBe(true);
    expect(result.alreadyApplied).toBe(true);
  });
});

describe("transitionRun", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("allows allocated -> running -> validating -> succeeded", () => {
    insertRun(db, { id: "run-1", state: "allocated", version: 1 });
    expect(
      transitionRun(db, {
        runId: "run-1",
        expectedState: "allocated",
        expectedVersion: 1,
        newState: "running",
      }).success,
    ).toBe(true);

    expect(
      transitionRun(db, {
        runId: "run-1",
        expectedState: "running",
        expectedVersion: 2,
        newState: "validating",
      }).success,
    ).toBe(true);

    expect(
      transitionRun(db, {
        runId: "run-1",
        expectedState: "validating",
        expectedVersion: 3,
        newState: "succeeded",
      }).success,
    ).toBe(true);
  });

  it("terminal run states are immutable", () => {
    insertRun(db, { id: "run-1", state: "succeeded", version: 4 });
    expect(() =>
      transitionRun(db, {
        runId: "run-1",
        expectedState: "succeeded",
        expectedVersion: 4,
        newState: "running",
      }),
    ).toThrow(TransitionError);
  });
});
