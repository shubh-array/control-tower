import { describe, expect, it } from "vitest";
import type { FocusQueueRow } from "../../client/src/lib/api.js";
import {
  findReviewQueueItem,
  resolveReviewNavigationItem,
  resolveReviewRoute,
} from "../../client/src/lib/review-route.js";

function row(overrides: Partial<FocusQueueRow> = {}): FocusQueueRow {
  return {
    jobId: "job-1",
    repositoryKey: "repo",
    repository: "org/repo",
    prNumber: 42,
    title: "Improve review flow",
    author: "dev",
    headSha: "a".repeat(40),
    eligibilityReasons: [],
    exclusionReasons: [],
    priority: "p1",
    priorityReasons: [],
    queueOrder: {
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "2026-07-13T10:00:00.000Z",
      normalizedRepositoryIdentity: "repo",
      prNumber: 42,
    },
    domains: ["sdk"],
    attentionState: "ready_for_analysis",
    jobState: "ready",
    advisorResult: null,
    discoveredAt: "2026-07-13T09:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("review route resolution", () => {
  it("prefers inbox navigation state when the job id matches", () => {
    const navigationItem = row({ jobId: "job-42", title: "From inbox" });

    expect(resolveReviewNavigationItem("job-42", navigationItem)).toEqual(
      navigationItem,
    );
    expect(
      resolveReviewRoute({
        jobId: "job-42",
        navigationItem,
        queueRows: [row({ jobId: "job-other" })],
      }),
    ).toEqual({ kind: "navigation", item: navigationItem });
  });

  it("ignores stale navigation state when the job id does not match", () => {
    const navigationItem = row({ jobId: "job-old" });

    expect(resolveReviewNavigationItem("job-42", navigationItem)).toBeNull();
  });

  it("resolves a deep link from fresh queue data when navigation state is absent", () => {
    const queueItem = row({ jobId: "job-42", title: "From queue" });
    const rows = [row({ jobId: "job-other" }), queueItem];

    expect(findReviewQueueItem("job-42", rows)).toEqual(queueItem);
    expect(
      resolveReviewRoute({
        jobId: "job-42",
        queueRows: rows,
      }),
    ).toEqual({ kind: "queue", item: queueItem });
  });

  it("reports missing context when queue data does not contain the job", () => {
    expect(
      resolveReviewRoute({
        jobId: "job-missing",
        queueRows: [row({ jobId: "job-other" })],
      }),
    ).toEqual({ kind: "missing" });
  });

  it("reports load errors separately from missing queue rows", () => {
    expect(
      resolveReviewRoute({
        jobId: "job-42",
        queueError: true,
      }),
    ).toEqual({ kind: "load-error" });
  });
});
