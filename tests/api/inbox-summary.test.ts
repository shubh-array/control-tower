import { describe, it, expect } from "vitest";
import type { ReviewQueueRow } from "../../src/api/contracts.js";
import { projectInboxSummary } from "../../src/api/projections/inbox-summary.js";

function row(overrides: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    jobId: null,
    repositoryKey: "pba-webapp",
    repository: "org/pba-webapp",
    prNumber: 42,
    title: "Fix bug",
    url: "https://github.com/org/pba-webapp/pull/42",
    author: "dev",
    headSha: "a".repeat(40),
    explicitRequest: false,
    eligibilityReasons: [],
    priority: "p1",
    priorityReasons: [],
    queueOrder: {
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "2026-07-10T12:00:00.000Z",
      normalizedRepositoryIdentity: "pba-webapp",
      prNumber: 42,
    },
    domains: [],
    jobState: null,
    stale: false,
    updatedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("projectInboxSummary", () => {
  it("aggregates primary and pipeline counters from queue rows", () => {
    const summary = projectInboxSummary(
      [
        row({
          explicitRequest: true,
          jobId: "job-1",
          jobState: "draft_ready",
        }),
        row({
          prNumber: 43,
          explicitRequest: true,
          jobState: null,
        }),
        row({
          prNumber: 44,
          jobId: "job-2",
          jobState: "running_agent",
        }),
        row({
          prNumber: 45,
          jobId: "job-3",
          jobState: "failed",
        }),
        row({
          prNumber: 46,
          jobId: "job-4",
          jobState: "draft_ready",
          stale: true,
        }),
      ],
      "2026-07-10T12:00:00.000Z",
    );

    expect(summary).toEqual({
      readyToReview: 2,
      explicitRequests: 2,
      totalEligible: 5,
      needsAnalysis: 1,
      analyzing: 1,
      failed: 1,
      stale: 1,
      lastPollTimestamp: "2026-07-10T12:00:00.000Z",
    });
  });
});
