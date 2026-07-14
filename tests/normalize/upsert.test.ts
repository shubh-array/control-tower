import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import {
  upsertEligiblePr,
  deleteReviewPr,
  upsertRepository,
} from "../../src/normalize/upsert.js";
import type { DiscoveredPr } from "../../src/github/types.js";
import type { PolicyDecision } from "../../src/policy/evaluate.js";
import { canonicalJsonSerialize } from "../../src/util/canonical-json.js";
import { sha256OfCanonicalJson } from "../../src/util/hash.js";

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

function minimalPr(repositoryId: string, overrides: Partial<DiscoveredPr> = {}): DiscoveredPr {
  return {
    repositoryId,
    githubOwnerRepo: "Org/repo",
    prNumber: 1,
    title: "Test PR",
    url: "https://github.com/Org/repo/pull/1",
    state: "OPEN",
    isDraft: false,
    authorLogin: "alice",
    headSha: "abc",
    baseSha: "def",
    labels: [],
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    changedFiles: [],
    unsafeFiles: [],
    reviewRequests: [],
    checks: [],
    reviews: [],
    comments: [],
    explicitRequest: false,
    ...overrides,
  };
}

describe("upsert FK safety", () => {
  it("upsert repo then eligible PR succeeds", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    upsertRepository(db, {
      id: "test-repo",
      github: "Org/repo",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });

    const prId = upsertEligiblePr(db, minimalPr("test-repo"), eligibleDecision);
    expect(prId).toBeGreaterThan(0);
  });

  it("upsert eligible PR without parent repo fails FK constraint", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    expect(() =>
      upsertEligiblePr(db, minimalPr("missing-repo"), eligibleDecision),
    ).toThrow();
  });

  it("persists policy_json and policy_hash on prs", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    upsertRepository(db, {
      id: "test-repo",
      github: "Org/repo",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });

    upsertEligiblePr(db, minimalPr("test-repo"), eligibleDecision);

    const row = db
      .prepare("SELECT policy_json, policy_hash FROM prs WHERE repository_id = ? AND pr_number = 1")
      .get("test-repo") as { policy_json: string; policy_hash: string };

    expect(row.policy_json).toBe(canonicalJsonSerialize(eligibleDecision));
    expect(row.policy_hash).toBe(sha256OfCanonicalJson(eligibleDecision));
  });

  it("dedupes duplicate check names from statusCheckRollup", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    upsertRepository(db, {
      id: "test-repo",
      github: "Org/repo",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });

    upsertEligiblePr(
      db,
      minimalPr("test-repo", {
        checks: [
          {
            __typename: "CheckRun",
            name: "CI",
            status: "COMPLETED",
            conclusion: "FAILURE",
            detailsUrl: "https://example.com/1",
          },
          {
            __typename: "CheckRun",
            name: "CI",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: "https://example.com/2",
          },
        ],
      }),
      eligibleDecision,
    );

    const rows = db
      .prepare("SELECT name, conclusion, details_url FROM pr_checks")
      .all() as Array<{ name: string; conclusion: string; details_url: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("CI");
    expect(rows[0]!.conclusion).toBe("SUCCESS");
    expect(rows[0]!.details_url).toBe("https://example.com/2");
  });

  it("deleteReviewPr cascades checks and comments", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    upsertRepository(db, {
      id: "test-repo",
      github: "Org/repo",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });

    upsertEligiblePr(
      db,
      minimalPr("test-repo", {
        checks: [
          {
            __typename: "CheckRun",
            name: "CI",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: "https://example.com/ci",
          },
        ],
        comments: [
          {
            authorLogin: "bob",
            body: "Looks good",
            createdAt: "2026-07-01T00:00:00Z",
            url: "https://example.com/comment",
          },
        ],
      }),
      eligibleDecision,
    );

    deleteReviewPr(db, "test-repo", 1);

    expect(db.prepare("SELECT * FROM prs").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM pr_checks").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM pr_comments").all()).toEqual([]);
  });
});
