import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import {
  deleteReviewPr,
  upsertEligiblePr,
  upsertRepository,
} from "../../src/normalize/upsert.js";
import type { DiscoveredPr } from "../../src/github/types.js";
import type { PolicyDecision } from "../../src/policy/evaluate.js";

const eligibleDecision: PolicyDecision = {
  eligible: true,
  eligibilityReasons: [],
  exclusionReasons: [],
  authorOnly: false,
  priorityStatus: "p1",
  prioritySortOrdinal: 1,
  priorityReasons: [],
  allPriorityReasons: [],
  selectedPriorityReason: null,
  analysisMode: "auto",
  autoAnalyzeReasons: [],
  selectedDomains: [],
  allDomainReasons: [],
};

function samplePr(): DiscoveredPr {
  return {
    repositoryId: "pba-webapp",
    githubOwnerRepo: "Powered-By-Array/pba-webapp",
    prNumber: 42,
    title: "Test PR",
    url: "https://github.com/Powered-By-Array/pba-webapp/pull/42",
    state: "OPEN",
    isDraft: false,
    authorLogin: "alice",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    labels: [],
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-09T14:30:00Z",
    changedFiles: [],
    unsafeFiles: [],
    reviewRequests: [],
    checks: [],
    reviews: [],
    comments: [],
    explicitRequest: false,
  };
}

function findActiveJobsByPr(
  db: ReturnType<typeof openDatabase>,
  repositoryKey: string,
  prNumber: number,
) {
  return db
    .prepare(
      `SELECT id, state, version
       FROM jobs
       WHERE repository_key = ? AND pr_number = ?
         AND state NOT IN ('superseded', 'cancelled', 'published', 'failed')`,
    )
    .all(repositoryKey, prNumber) as Array<{
    id: string;
    state: string;
    version: number;
  }>;
}

function retireReviewPr(
  db: ReturnType<typeof openDatabase>,
  repositoryId: string,
  repositoryKey: string,
  prNumber: number,
): void {
  for (const job of findActiveJobsByPr(db, repositoryKey, prNumber)) {
    db.prepare(
      `UPDATE jobs SET state = 'superseded', version = version + 1
       WHERE id = ? AND version = ?`,
    ).run(job.id, job.version);
  }
  deleteReviewPr(db, repositoryId, prNumber);
}

function insertJob(
  db: ReturnType<typeof openDatabase>,
  id: string,
  state: string,
): void {
  db.prepare(
    `INSERT INTO jobs (
      id, identity_hash, repository_key, pr_number, head_sha, source_mode,
      policy_hash, state, version
    ) VALUES (?, ?, 'pba-webapp', 42, ?, 'registered-source', 'policy-hash', ?, 1)`,
  ).run(id, `identity-${id}`, "a".repeat(40), state);
}

describe("retireReviewPr job supersession", () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);
    upsertRepository(db, {
      id: "pba-webapp",
      github: "Powered-By-Array/pba-webapp",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });
    upsertEligiblePr(db, samplePr(), eligibleDecision);
  });

  it("supersedes queued and draft-ready jobs but leaves terminal jobs unchanged", () => {
    insertJob(db, "job-queued", "queued");
    insertJob(db, "job-draft", "draft_ready");
    insertJob(db, "job-failed", "failed");
    insertJob(db, "job-published", "published");
    insertJob(db, "job-cancelled", "cancelled");
    insertJob(db, "job-superseded", "superseded");

    retireReviewPr(db, "pba-webapp", "pba-webapp", 42);

    const states = Object.fromEntries(
      (
        db
          .prepare(`SELECT id, state FROM jobs ORDER BY id`)
          .all() as Array<{ id: string; state: string }>
      ).map((row) => [row.id, row.state]),
    );

    expect(states).toEqual({
      "job-queued": "superseded",
      "job-draft": "superseded",
      "job-failed": "failed",
      "job-published": "published",
      "job-cancelled": "cancelled",
      "job-superseded": "superseded",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM prs").get()).toEqual({ count: 0 });
  });
});
