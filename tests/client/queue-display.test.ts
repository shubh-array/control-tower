import { describe, it, expect } from "vitest";
import type { ReviewQueueRow } from "../../client/src/lib/api.js";
import {
  deriveInboxPresentation,
  sortInboxRows,
  summarizeReasons,
} from "../../client/src/lib/queue-display.js";

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

describe("deriveInboxPresentation", () => {
  it("eligible row with no job => needs-analysis / analyze", () => {
    expect(deriveInboxPresentation(row())).toEqual({
      chip: "needs-analysis",
      primaryAction: "analyze",
    });
  });

  it("running_agent => analyzing / no action", () => {
    expect(
      deriveInboxPresentation(row({ jobId: "job-1", jobState: "running_agent" })),
    ).toEqual({ chip: "analyzing", primaryAction: null });
  });

  it("draft_ready => ready / open-review", () => {
    expect(
      deriveInboxPresentation(row({ jobId: "job-1", jobState: "draft_ready" })),
    ).toEqual({ chip: "ready", primaryAction: "open-review" });
  });

  it("failed job => failed / retry", () => {
    expect(
      deriveInboxPresentation(row({ jobId: "job-1", jobState: "failed" })),
    ).toEqual({ chip: "failed", primaryAction: "retry" });
  });
});

describe("sortInboxRows", () => {
  it("sorts by queue tuple order", () => {
    const items = [
      row({
        prNumber: 5,
        queueOrder: {
          prioritySortOrdinal: 1,
          explicitRequestSort: 0,
          queueTimestamp: "2026-07-10T00:00:00.000Z",
          normalizedRepositoryIdentity: "a",
          prNumber: 5,
        },
      }),
      row({
        prNumber: 3,
        queueOrder: {
          prioritySortOrdinal: 0,
          explicitRequestSort: 0,
          queueTimestamp: "2026-07-10T00:00:00.000Z",
          normalizedRepositoryIdentity: "a",
          prNumber: 3,
        },
      }),
      row({
        prNumber: 1,
        queueOrder: {
          prioritySortOrdinal: 0,
          explicitRequestSort: 0,
          queueTimestamp: "2026-07-10T00:00:00.000Z",
          normalizedRepositoryIdentity: "a",
          prNumber: 1,
        },
      }),
    ];

    const input = [...items];
    const sorted = sortInboxRows(items);
    expect(sorted.map((item) => item.prNumber)).toEqual([1, 3, 5]);
    expect(items).toEqual(input);
  });
});

describe("summarizeReasons", () => {
  it("formats eligible_path, explicit request, eligible author, and empty cases", () => {
    expect(
      summarizeReasons(
        row({
          eligibilityReasons: [
            { code: "eligible_path", matchedPath: "sdk/a.ts" },
            { code: "eligible_path", matchedPath: "sdk/b.ts" },
          ],
        }),
      ),
    ).toBe("eligible path · sdk/a.ts");

    expect(
      summarizeReasons(
        row({
          eligibilityReasons: [{ code: "explicit_review_request", requestedLogin: "dev" }],
        }),
      ),
    ).toBe("explicit review request");

    expect(
      summarizeReasons(
        row({ eligibilityReasons: [{ code: "eligible_author", authorLogin: "dev" }] }),
      ),
    ).toBe("eligible author");

    expect(summarizeReasons(row())).toBe("No eligibility reason recorded");
  });

  it("eligible_path without string matchedPath uses matched path fallback", () => {
    expect(
      summarizeReasons(
        row({ eligibilityReasons: [{ code: "eligible_path" }] }),
      ),
    ).toBe("eligible path · matched path");
  });
});
