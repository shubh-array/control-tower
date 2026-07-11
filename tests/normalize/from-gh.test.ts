import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toDiscoveredPr } from "../../src/normalize/from-gh.js";
import type {
  GhPrListItem,
  GhPrViewResult,
  GhSearchPrItem,
} from "../../src/github/types.js";

function loadFixture<T>(name: string): T {
  const raw = readFileSync(
    new URL(`../fixtures/gh/${name}`, import.meta.url),
    "utf-8",
  );
  return JSON.parse(raw) as T;
}

describe("toDiscoveredPr", () => {
  it("maps GhSearchPrItem with explicit request flag", () => {
    const items = loadFixture<GhSearchPrItem[]>("search-review-requested.json");
    const item = items[0]!;

    const pr = toDiscoveredPr(item, "pba-webapp", true);

    expect(pr.repositoryId).toBe("pba-webapp");
    expect(pr.githubOwnerRepo).toBe("Powered-By-Array/pba-webapp");
    expect(pr.prNumber).toBe(101);
    expect(pr.authorLogin).toBe("alice");
    expect(pr.explicitRequest).toBe(true);
    expect(pr.reviewRequests[0]?.login).toBe("shubh-array");
  });

  it("maps GhPrListItem with checks from statusCheckRollup", () => {
    const items = loadFixture<GhPrListItem[]>("pr-list-repo.json");
    const item = items[0]!;

    const pr = toDiscoveredPr(item, "pba-webapp", false);

    expect(pr.prNumber).toBe(42);
    expect(pr.headRef).toBe("refactor-api");
    expect(pr.baseRef).toBe("main");
    expect(pr.checks).toHaveLength(1);
    expect(pr.checks[0]?.name).toBe("CI / build");
    expect(pr.explicitRequest).toBe(false);
  });

  it("maps GhPrViewResult with body, files, reviews, and comments", () => {
    const item = loadFixture<GhPrViewResult>("pr-view-detail.json");

    const pr = toDiscoveredPr(item, "pba-webapp", false);

    expect(pr.body).toContain("ENG-1234");
    expect(pr.changedFiles).toEqual([
      "src/api-clients/base.ts",
      "src/api-clients/auth.ts",
    ]);
    expect(pr.reviews[0]?.authorLogin).toBe("carol");
    expect(pr.comments[0]?.authorLogin).toBe("bob");
  });
});
