import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GitHubAdapter } from "../../src/github/adapter.js";

function loadFixture<T>(name: string): T {
  const raw = readFileSync(new URL(`../fixtures/gh/${name}`, import.meta.url), "utf-8");
  return JSON.parse(raw) as T;
}

describe("GitHubAdapter fixture parsing", () => {
  it("parses search-review-requested fixture", async () => {
    const fixture = loadFixture("search-review-requested.json");
    const mockExec = vi.fn().mockResolvedValue(fixture);
    const adapter = new GitHubAdapter("github.com", mockExec, vi.fn());

    const results = await adapter.searchReviewRequested("shubh-array", [
      "Powered-By-Array",
    ]);

    expect(results).toHaveLength(1);
    const firstResult = results[0];
    expect(firstResult).toBeDefined();
    expect(firstResult!.number).toBe(101);
    expect(firstResult!.author.login).toBe("alice");
    const firstReviewRequest = firstResult!.reviewRequests[0];
    expect(firstReviewRequest).toBeDefined();
    expect(firstReviewRequest!.login).toBe("shubh-array");
  });

  it("passes exact login to --review-requested, never @me", async () => {
    const mockExec = vi.fn().mockResolvedValue([]);
    const adapter = new GitHubAdapter("github.com", mockExec, vi.fn());

    await adapter.searchReviewRequested("shubh-array", ["Powered-By-Array"]);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const firstCall = mockExec.mock.calls[0];
    expect(firstCall).toBeDefined();
    const args = firstCall![0] as string[];
    expect(args).toContain("--review-requested=shubh-array");
    expect(args.join(" ")).not.toContain("@me");
  });

  it("parses pr-list-repo fixture", async () => {
    const fixture = loadFixture("pr-list-repo.json");
    const mockExec = vi.fn().mockResolvedValue(fixture);
    const adapter = new GitHubAdapter("github.com", mockExec, vi.fn());

    const results = await adapter.listRepoPrs("Powered-By-Array/pba-webapp");

    expect(results).toHaveLength(2);
    const firstResult = results[0];
    const secondResult = results[1];
    expect(firstResult).toBeDefined();
    expect(secondResult).toBeDefined();
    expect(firstResult!.number).toBe(42);
    expect(secondResult!.isDraft).toBe(true);
  });

  it("parses pr-view-detail fixture", async () => {
    const fixture = loadFixture("pr-view-detail.json");
    const mockExec = vi.fn().mockResolvedValue(fixture);
    const adapter = new GitHubAdapter("github.com", mockExec, vi.fn());

    const result = await adapter.viewPr("Powered-By-Array/pba-webapp", 42);

    expect(result.body).toContain("ENG-1234");
    expect(result.files).toHaveLength(2);
    expect(result.reviews).toHaveLength(1);
    expect(result.comments).toHaveLength(1);
  });

  it("sets GH_HOST via options for all commands", async () => {
    const mockExec = vi.fn().mockResolvedValue([]);
    const adapter = new GitHubAdapter("github.example.com", mockExec, vi.fn());

    await adapter.searchReviewRequested("user", ["org"]);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const firstCall = mockExec.mock.calls[0];
    expect(firstCall).toBeDefined();
    const options = firstCall![1];
    expect(options.host).toBe("github.example.com");
  });
});
