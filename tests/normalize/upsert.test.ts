import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { upsertPr, upsertRepository } from "../../src/normalize/upsert.js";
import type { DiscoveredPr } from "../../src/github/types.js";

function minimalPr(repositoryId: string): DiscoveredPr {
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
});
