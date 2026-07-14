import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { upsertRepository, upsertEligiblePr } from "../../src/normalize/upsert.js";
import { WorkGraph } from "../../src/orchestrator/work-graph.js";
import { createOrchestratorFacade } from "../../src/orchestrator/facade.js";
import { PrNotEligibleForReviewError } from "../../src/orchestrator/analyze-errors.js";
import type { PolicyDecision } from "../../src/policy/evaluate.js";
import type { DiscoveredPr } from "../../src/github/types.js";

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: true,
    priorityStatus: "p2",
    prioritySortOrdinal: 2,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: "on_demand",
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function seedAuthorOnlyPr(db: Database.Database): void {
  upsertRepository(db, {
    id: "pba-webapp",
    github: "Org/pba-webapp",
    host: "github.com",
    defaultBranch: "main",
    resourceClass: "medium",
  });

  const pr: DiscoveredPr = {
    repositoryId: "pba-webapp",
    githubOwnerRepo: "Org/pba-webapp",
    prNumber: 7,
    title: "Author-only PR",
    body: "",
    url: "https://github.com/Org/pba-webapp/pull/7",
    state: "OPEN",
    isDraft: false,
    authorLogin: "dev",
    headSha: "d".repeat(40),
    baseSha: "e".repeat(40),
    labels: [],
    additions: 1,
    deletions: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    changedFiles: ["src/a.ts"],
    unsafeFiles: [],
    reviewRequests: [],
    checks: [],
    reviews: [],
    comments: [],
    explicitRequest: false,
  };

  upsertEligiblePr(db, pr, stubPolicy());
}

describe("manual analyze bootstrap behavior", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("does not turn a manual request into explicit_request persistence", () => {
    seedAuthorOnlyPr(db);

    const insertedJobs: Array<Record<string, unknown>> = [];
    const facade = createOrchestratorFacade({
      getFocusQueue: () => new WorkGraph(db).getFocusQueue(),
      getJob: () => null,
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: (input) => {
        const prRow = db
          .prepare(
            `SELECT head_sha, repository_id, policy_json, explicit_request
             FROM prs WHERE repository_id = ? AND pr_number = ?`,
          )
          .get(input.repositoryKey, input.prNumber) as
          | {
              head_sha: string;
              repository_id: string;
              policy_json: string;
              explicit_request: number;
            }
          | undefined;

        if (!prRow) {
          throw new PrNotEligibleForReviewError();
        }

        const policy = JSON.parse(prRow.policy_json) as PolicyDecision;
        if (!policy.eligible) {
          throw new PrNotEligibleForReviewError();
        }

        insertedJobs.push({
          headSha: prRow.head_sha,
          manualRequest: true,
          explicitRequest: prRow.explicit_request === 1,
        });
        return "job-manual";
      },
      enqueueRetry: () => "job-1",
      getHealthStatus: () => ({
        activeJobs: 0,
        queuedJobs: 0,
        failedJobsLast24h: 0,
        uptime: 0,
        lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    });

    facade.requestAnalyze({ repositoryKey: "pba-webapp", prNumber: 7 });

    const row = db
      .prepare(`SELECT explicit_request FROM prs WHERE repository_id = ? AND pr_number = ?`)
      .get("pba-webapp", 7) as { explicit_request: number };
    expect(row.explicit_request).toBe(0);
    expect(insertedJobs[0]).toMatchObject({
      headSha: "d".repeat(40),
      manualRequest: true,
      explicitRequest: false,
    });
  });

  it("rejects analyze when PR row is absent", () => {
    const facade = createOrchestratorFacade({
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: () => null,
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: () => {
        throw new PrNotEligibleForReviewError();
      },
      enqueueRetry: () => "job-1",
      getHealthStatus: () => ({
        activeJobs: 0,
        queuedJobs: 0,
        failedJobsLast24h: 0,
        uptime: 0,
        lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    });

    expect(() =>
      facade.requestAnalyze({ repositoryKey: "repo-a", prNumber: 9 }),
    ).toThrow("PR is not eligible for review");
  });
});
