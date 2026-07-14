import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import {
  projectFocusQueue,
  projectReviewQueueItem,
  loadQueueEnrichment,
} from "../../src/api/projections/queue.js";
import type { ReviewQueueItem } from "../../src/policy/evaluate.js";

function stubItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    repositoryKey: "pba-webapp",
    prNumber: 42,
    headSha: "c".repeat(40),
    title: "Fix bug",
    url: "https://github.com/org/pba-webapp/pull/42",
    author: "dev",
    updatedAt: "2026-07-10T12:00:00.000Z",
    explicitRequest: true,
    explicitRequestTimestamp: null,
    policy: {
      eligible: true,
      eligibilityReasons: [
        { code: "explicit_review_request", requestedLogin: "dev" },
      ],
      exclusionReasons: [],
      authorOnly: false,
      priorityStatus: "p1",
      prioritySortOrdinal: 1,
      priorityReasons: [],
      allPriorityReasons: [],
      selectedPriorityReason: null,
      analysisMode: "on_demand",
      autoAnalyzeReasons: [],
      selectedDomains: [],
      allDomainReasons: [],
    },
    ...overrides,
  };
}

describe("queue projection summary", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ct-queue-summary-"));
    db = openDatabase(join(tmp, "test.sqlite"));
    runMigrations(db);
    db.prepare(
      `INSERT INTO repositories (id, github_identity, github_owner, github_repo, default_branch, resource_class)
       VALUES ('pba-webapp', 'github.com/org/pba-webapp', 'org', 'pba-webapp', 'main', 'medium')`,
    ).run();
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("marks stale when job head_sha differs from projected PR head", () => {
    db.prepare(
      `INSERT INTO jobs (id, identity_hash, repository_key, pr_number, head_sha, source_mode, policy_hash, state, version)
       VALUES ('job-1', 'hash-1', 'pba-webapp', 42, ?, 'registered-source', 'ph', 'draft_ready', 1)`,
    ).run("a".repeat(40));

    const enrichment = loadQueueEnrichment(db);
    const row = projectReviewQueueItem(stubItem(), enrichment);

    expect(row.explicitRequest).toBe(true);
    expect(row.stale).toBe(true);
    expect(row.jobState).toBe("draft_ready");
  });

  it("returns summary with focus queue projection", () => {
    db.prepare(
      `INSERT INTO jobs (id, identity_hash, repository_key, pr_number, head_sha, source_mode, policy_hash, state, version)
       VALUES ('job-1', 'hash-1', 'pba-webapp', 42, ?, 'registered-source', 'ph', 'draft_ready', 1)`,
    ).run("c".repeat(40));

    const projected = projectFocusQueue(
      db,
      { now: [stubItem()], next: [], monitor: [] },
      "2026-07-10T12:00:00.000Z",
    );

    expect(projected.summary).toEqual({
      readyToReview: 1,
      explicitRequests: 1,
      totalEligible: 1,
      needsAnalysis: 0,
      analyzing: 0,
      failed: 0,
      stale: 0,
      lastPollTimestamp: "2026-07-10T12:00:00.000Z",
    });
  });
});
