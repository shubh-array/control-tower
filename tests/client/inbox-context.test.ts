import { describe, it, expect } from "vitest";
import type { TrackedQueueRow } from "../../client/src/lib/api.js";
import { buildInboxContext } from "../../client/src/lib/inbox-context.js";

function row(overrides: Partial<TrackedQueueRow> = {}): TrackedQueueRow {
  return {
    jobId: null,
    repositoryKey: "pba-webapp",
    repository: "org/pba-webapp",
    prNumber: 42,
    title: "Fix bug",
    url: "https://github.com/org/pba-webapp/pull/42",
    author: "dev",
    headSha: "a".repeat(40),
    eligibilityReasons: [],
    exclusionReasons: [],
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
    attentionState: "ready_for_analysis",
    jobState: null,
    advisorResult: null,
    discoveredAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildInboxContext", () => {
  it("returns labeled priority and attention reason", () => {
    expect(
      buildInboxContext(
        row({
          eligibilityReasons: [{ code: "explicit_review_request" }],
        }),
      ),
    ).toEqual([
      { label: "Priority", value: "P1" },
      { label: "Attention reason", value: "Explicit review request" },
    ]);
  });
});
