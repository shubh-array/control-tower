import { describe, it, expect } from "vitest";
import type { FocusQueueRow } from "../../client/src/lib/api.js";
import {
  INBOX_REFRESH_ERROR,
  inboxRowKey,
  mergeRowPatch,
  patchRowAfterMutation,
  patchRowAfterRetry,
} from "../../client/src/lib/inbox-resilience.js";
import { deriveInboxPresentation } from "../../client/src/lib/queue-display.js";

function row(overrides: Partial<FocusQueueRow> = {}): FocusQueueRow {
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

describe("inbox resilience helpers", () => {
  it("uses a non-destructive refresh error message", () => {
    expect(INBOX_REFRESH_ERROR).toContain("action succeeded");
    expect(INBOX_REFRESH_ERROR).not.toContain("failed");
  });

  it("optimistic analyze patch removes the Analyze CTA", () => {
    const item = row();
    const patched = patchRowAfterMutation(item, "job-new");
    expect(deriveInboxPresentation(patched)).toEqual({
      chip: "analyzing",
      primaryAction: null,
    });
  });

  it("optimistic retry patch removes the Retry CTA", () => {
    const item = row({ jobId: "job-1", jobState: "failed" });
    const patched = patchRowAfterRetry(item);
    expect(deriveInboxPresentation(patched)).toEqual({
      chip: "analyzing",
      primaryAction: null,
    });
  });

  it("mergeRowPatch applies only the matching row key", () => {
    const item = row();
    const patches = {
      [inboxRowKey(item)]: { jobId: "job-new", jobState: "queued" },
      "org/other-99": { jobId: "other" },
    };
    expect(mergeRowPatch(item, patches).jobId).toBe("job-new");
    expect(mergeRowPatch(row({ prNumber: 99, repository: "org/other" }), patches).jobId).toBe(
      "other",
    );
  });
});
