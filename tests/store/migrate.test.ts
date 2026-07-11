import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, getCurrentVersion } from "../../src/store/migrate.js";
import { openDatabase } from "../../src/store/db.js";

describe("migration runner", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  it("applies initial migration to empty database", () => {
    runMigrations(db);
    const version = getCurrentVersion(db);
    expect(version).toBe(1);
  });

  it("creates expected tables", () => {
    runMigrations(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("repositories");
    expect(names).toContain("prs");
    expect(names).toContain("pr_files");
    expect(names).toContain("pr_checks");
    expect(names).toContain("pr_reviews");
    expect(names).toContain("pr_comments");
    expect(names).toContain("review_requests");
    expect(names).toContain("discovery_checkpoints");
    expect(names).toContain("attention_items");
    expect(names).toContain("jobs");
    expect(names).toContain("runs");
    expect(names).toContain("advisor_runs");
    expect(names).toContain("audit_events");
    expect(names).toContain("schema_migrations");
    expect(names).not.toContain("pull_requests");
  });

  it("jobs and runs have CAS/orchestrator columns", () => {
    runMigrations(db);
    const jobCols = (
      db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    for (const col of [
      "identity_hash",
      "repository_key",
      "policy_hash",
      "version",
      "failure_reason",
      "priority_sort_ordinal",
      "explicit_request_sort",
      "queue_timestamp",
      "queued_at",
    ]) {
      expect(jobCols).toContain(col);
    }
    const runCols = (
      db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(runCols).toContain("version");
    expect(runCols).toContain("failure_reason");
  });

  it("is idempotent", () => {
    runMigrations(db);
    runMigrations(db);
    expect(getCurrentVersion(db)).toBe(1);
  });

  it("records migration in schema_migrations", () => {
    runMigrations(db);
    const rows = db
      .prepare("SELECT version, name FROM schema_migrations")
      .all() as Array<{ version: number; name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.name).toBe("001_initial");
  });
});

describe("openDatabase", () => {
  it("opens database, runs migrations, and reports version 1", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db);
      expect(getCurrentVersion(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});
