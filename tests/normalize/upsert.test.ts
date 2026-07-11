import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import {
  upsertDiscoveredPr,
  upsertPr,
  upsertRepository,
} from "../../src/normalize/upsert.js";
import type { DiscoveredPr } from "../../src/github/types.js";

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
  it("upsert repo then PR succeeds", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    upsertRepository(db, {
      id: "test-repo",
      github: "Org/repo",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });

    const prId = upsertPr(db, minimalPr("test-repo"));
    expect(prId).toBeGreaterThan(0);
  });

  it("upsert PR without parent repo fails FK constraint", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    expect(() => upsertPr(db, minimalPr("missing-repo"))).toThrow();
  });

  it("persists labels_json capped at 50", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);

    upsertRepository(db, {
      id: "test-repo",
      github: "Org/repo",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });

    const labels = Array.from({ length: 60 }, (_, i) => `label-${i}`);
    upsertPr(db, minimalPr("test-repo", { labels }));

    const row = db
      .prepare("SELECT labels_json FROM prs WHERE repository_id = ? AND pr_number = 1")
      .get("test-repo") as { labels_json: string };

    expect(JSON.parse(row.labels_json)).toHaveLength(50);
    expect(JSON.parse(row.labels_json)[0]).toBe("label-0");
    expect(JSON.parse(row.labels_json)[49]).toBe("label-49");
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

    upsertDiscoveredPr(
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
    );

    const rows = db
      .prepare("SELECT name, conclusion, details_url FROM pr_checks")
      .all() as Array<{ name: string; conclusion: string; details_url: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("CI");
    expect(rows[0]!.conclusion).toBe("SUCCESS");
    expect(rows[0]!.details_url).toBe("https://example.com/2");
  });
});
