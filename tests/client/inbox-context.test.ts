import { describe, it, expect } from "vitest";
import type { ReviewQueueRow } from "../../client/src/lib/api.js";
import { buildInboxContext } from "../../client/src/lib/inbox-context.js";

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
    updatedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildInboxContext", () => {
  it("returns labeled priority and review reason", () => {
    expect(
      buildInboxContext(
        row({
          eligibilityReasons: [{ code: "explicit_review_request" }],
        }),
      ),
    ).toEqual([
      { label: "Priority", value: "P1" },
      { label: "Review reason", value: "Explicit review request" },
    ]);
  });
});
