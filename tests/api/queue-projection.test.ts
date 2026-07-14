import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { projectReviewQueueItem, loadQueueEnrichment } from "../../src/api/projections/queue.js";
import type { ReviewQueueItem } from "../../src/policy/evaluate.js";

function stubItem(): ReviewQueueItem {
  return {
    repositoryKey: "pba-webapp",
    prNumber: 42,
    headSha: "a".repeat(40),
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
      priorityReasons: [
        {
          code: "priority_rule",
          tier: "p1",
          declarationIndex: 0,
          matchedPath: "src/a.ts",
          matchedRule: "backend",
        },
      ],
      allPriorityReasons: [],
      selectedPriorityReason: null,
      analysisMode: "on_demand",
      autoAnalyzeReasons: [],
      selectedDomains: [
        {
          domain: "backend",
          selectedPriority: 1,
          selectedDeclarationIndex: 0,
          matchedPaths: ["src/a.ts"],
          allReasons: [],
        },
      ],
      allDomainReasons: [],
    },
  };
}

describe("queue projection", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ct-queue-proj-"));
    db = openDatabase(join(tmp, "test.sqlite"));
    runMigrations(db);
    db.prepare(
      `INSERT INTO repositories (id, github_identity, github_owner, github_repo, default_branch, resource_class)
       VALUES ('pba-webapp', 'github.com/org/pba-webapp', 'org', 'pba-webapp', 'main', 'medium')`,
    ).run();
    db.prepare(
      `INSERT INTO jobs (id, identity_hash, repository_key, pr_number, head_sha, source_mode, policy_hash, state, version)
       VALUES ('job-1', 'hash-1', 'pba-webapp', 42, ?, 'registered-source', 'ph', 'queued', 1)`,
    ).run("a".repeat(40));
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("projects flat ReviewQueueRow with jobId and review fields only", () => {
    const enrichment = loadQueueEnrichment(db);
    const row = projectReviewQueueItem(stubItem(), enrichment);
    expect(row.jobId).toBe("job-1");
    expect(row.repositoryKey).toBe("pba-webapp");
    expect(row.repository).toBe("org/pba-webapp");
    expect(row.url).toBe("https://github.com/org/pba-webapp/pull/42");
    expect(row.queueOrder).toEqual({
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "2026-07-10T12:00:00.000Z",
      normalizedRepositoryIdentity: "pba-webapp",
      prNumber: 42,
    });
    expect(row.priority).toBe("p1");
    expect(row.domains).toEqual(["backend"]);
    expect(row.eligibilityReasons[0]?.code).toBe("explicit_review_request");
    expect(row).not.toHaveProperty("attentionState");
    expect(row).not.toHaveProperty("advisorResult");
    expect(row).not.toHaveProperty("exclusionReasons");
  });

  it("uses stable unknown queue timestamp when updatedAt is absent", () => {
    const enrichment = loadQueueEnrichment(db);
    const item = { ...stubItem(), updatedAt: "" };
    const rowA = projectReviewQueueItem(item, enrichment);
    const rowB = projectReviewQueueItem(item, enrichment);
    expect(rowA.queueOrder.queueTimestamp).toBe("unknown");
    expect(rowB.queueOrder).toEqual(rowA.queueOrder);
  });
});
