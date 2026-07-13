import { describe, it, expect } from "vitest";
import type { TrackedQueueRow } from "../../client/src/lib/api.js";
import {
  isEligible,
  deriveInboxPresentation,
  sortInboxRows,
  summarizeReasons,
  filterCoverageRows,
} from "../../client/src/lib/queue-display.js";

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

function advisor(
  overrides: Partial<NonNullable<TrackedQueueRow["advisorResult"]>> = {},
): NonNullable<TrackedQueueRow["advisorResult"]> {
  return {
    relevance: "medium",
    risk: "medium",
    explanation: "Review changes.",
    recommendedAction: "review",
    confidence: "high",
    unknowns: [],
    stale: false,
    ...overrides,
  };
}

describe("isEligible", () => {
  it("returns true when ranked and not excluded", () => {
    expect(isEligible(row())).toBe(true);
  });

  it("returns false when unranked or excluded", () => {
    expect(isEligible(row({ priority: "unranked" }))).toBe(false);
    expect(
      isEligible(
        row({ exclusionReasons: [{ code: "no_eligible_path_or_author_match" }] }),
      ),
    ).toBe(false);
  });
});

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

  it("unranked or excluded => waiting / no action", () => {
    const unranked = row({ priority: "unranked" });
    expect(deriveInboxPresentation(unranked)).toEqual({
      chip: "waiting",
      primaryAction: null,
    });
    expect(isEligible(unranked)).toBe(false);

    const excluded = row({
      exclusionReasons: [{ code: "no_eligible_path_or_author_match" }],
    });
    expect(deriveInboxPresentation(excluded)).toEqual({
      chip: "waiting",
      primaryAction: null,
    });
    expect(isEligible(excluded)).toBe(false);
  });
});

describe("sortInboxRows", () => {
  it("sorts current advice before unadvised, then relevance, risk, and queue tuple", () => {
    const items = [
      row({
        prNumber: 5,
        advisorResult: null,
        queueOrder: {
          prioritySortOrdinal: 0,
          explicitRequestSort: 0,
          queueTimestamp: "2026-07-10T00:00:00.000Z",
          normalizedRepositoryIdentity: "a",
          prNumber: 5,
        },
      }),
      row({
        prNumber: 4,
        advisorResult: advisor({ relevance: "low", risk: "high" }),
        queueOrder: {
          prioritySortOrdinal: 0,
          explicitRequestSort: 0,
          queueTimestamp: "2026-07-10T00:00:00.000Z",
          normalizedRepositoryIdentity: "a",
          prNumber: 4,
        },
      }),
      row({
        prNumber: 3,
        advisorResult: advisor({ relevance: "critical", risk: "medium" }),
        queueOrder: {
          prioritySortOrdinal: 0,
          explicitRequestSort: 0,
          queueTimestamp: "2026-07-10T00:00:00.000Z",
          normalizedRepositoryIdentity: "a",
          prNumber: 3,
        },
      }),
      row({
        prNumber: 2,
        advisorResult: advisor({ relevance: "high", risk: "critical" }),
        queueOrder: {
          prioritySortOrdinal: 0,
          explicitRequestSort: 0,
          queueTimestamp: "2026-07-10T00:00:00.000Z",
          normalizedRepositoryIdentity: "b",
          prNumber: 2,
        },
      }),
      row({
        prNumber: 1,
        advisorResult: advisor({ relevance: "high", risk: "critical" }),
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
    expect(sorted.map((item) => item.prNumber)).toEqual([3, 1, 2, 4, 5]);
    expect(items).toEqual(input);
  });

  it("treats stale advice as non-current and sorts it deterministically", () => {
    const stale = row({
      prNumber: 2,
      advisorResult: advisor({
        relevance: "critical",
        risk: "critical",
        stale: true,
      }),
      queueOrder: {
        prioritySortOrdinal: 0,
        explicitRequestSort: 0,
        queueTimestamp: "2026-07-10T00:00:00.000Z",
        normalizedRepositoryIdentity: "a",
        prNumber: 2,
      },
    });
    const current = row({
      prNumber: 1,
      advisorResult: advisor({ relevance: "high", risk: "critical" }),
      queueOrder: {
        prioritySortOrdinal: 0,
        explicitRequestSort: 0,
        queueTimestamp: "2026-07-10T00:00:00.000Z",
        normalizedRepositoryIdentity: "a",
        prNumber: 1,
      },
    });

    expect(sortInboxRows([stale, current]).map((item) => item.prNumber)).toEqual([
      1, 2,
    ]);
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

describe("filterCoverageRows", () => {
  const items = [
    row({ prNumber: 1, priority: "p1", title: "Auth fix", author: "alice" }),
    row({
      prNumber: 2,
      priority: "unranked",
      exclusionReasons: [{ code: "no_eligible_path_or_author_match" }],
      title: "Docs tweak",
      author: "bob",
    }),
    row({ prNumber: 3, priority: "p2", title: "SDK update", author: "carol" }),
  ];

  it("defaults to eligible-only filter", () => {
    expect(filterCoverageRows(items, "eligible", "")).toHaveLength(2);
  });

  it("filters ineligible and all modes", () => {
    expect(filterCoverageRows(items, "ineligible", "").map((i) => i.prNumber)).toEqual([
      2,
    ]);
    expect(filterCoverageRows(items, "all", "").map((i) => i.prNumber)).toEqual([
      1, 2, 3,
    ]);
  });

  it("searches repository#pr, title, and author case-insensitively", () => {
    expect(
      filterCoverageRows(items, "all", " org/pba-webapp#3 ").map((i) => i.prNumber),
    ).toEqual([3]);
    expect(filterCoverageRows(items, "all", "SDK").map((i) => i.prNumber)).toEqual([3]);
    expect(filterCoverageRows(items, "all", "ALICE").map((i) => i.prNumber)).toEqual([1]);
  });

  it("does not mutate the source array", () => {
    const source = [...items];
    filterCoverageRows(items, "all", "sdk");
    expect(items).toEqual(source);
  });
});
