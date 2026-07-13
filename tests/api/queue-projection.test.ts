import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { projectTrackedItem, loadQueueEnrichment } from "../../src/api/projections/queue.js";
import type { AllTrackedItem } from "../../src/policy/evaluate.js";

function stubItem(): AllTrackedItem {
  return {
    repositoryKey: "pba-webapp",
    prNumber: 42,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    title: "Fix bug",
    author: "dev",
    draft: false,
    labels: [],
    additions: 1,
    deletions: 0,
    changedFiles: ["src/a.ts"],
    reviewRequested: true,
    checkSummary: [],
    updatedAt: "2026-07-10T12:00:00.000Z",
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
    sourceMode: "registered-source",
    bodyTruncated: "",
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
      `INSERT INTO attention_items (id, repository_id, repository_key, pr_number, state, priority_sort_ordinal, source_mode)
       VALUES ('att-1', 'pba-webapp', 'pba-webapp', 42, 'ready_for_analysis', 1, 'registered-source')`,
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

  it("projects flat TrackedQueueRow with jobId and attentionState", () => {
    const enrichment = loadQueueEnrichment(db);
    const row = projectTrackedItem(stubItem(), enrichment);
    expect(row.jobId).toBe("job-1");
    expect(row.repositoryKey).toBe("pba-webapp");
    expect(row.repository).toBe("org/pba-webapp");
    expect(row.queueOrder).toEqual({
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "2026-07-10T12:00:00.000Z",
      normalizedRepositoryIdentity: "pba-webapp",
      prNumber: 42,
    });
    expect(row.attentionState).toBe("ready_for_analysis");
    expect(row.priority).toBe("p1");
    expect(row.domains).toEqual(["backend"]);
    expect(row.eligibilityReasons[0]?.code).toBe("explicit_review_request");
  });

  it("uses stable unknown queue timestamp when updatedAt is absent", () => {
    const enrichment = loadQueueEnrichment(db);
    const item = { ...stubItem(), updatedAt: null };
    const rowA = projectTrackedItem(item, enrichment);
    const rowB = projectTrackedItem(item, enrichment);
    expect(rowA.queueOrder).toEqual({
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "unknown",
      normalizedRepositoryIdentity: "pba-webapp",
      prNumber: 42,
    });
    expect(rowB.queueOrder).toEqual(rowA.queueOrder);
  });
});
