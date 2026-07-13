import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { CoverageActionCell } from "../src/routes/AllTracked.js";
import type { TrackedQueueRow } from "../src/lib/api.js";
import { INBOX_REFRESH_ERROR } from "../src/lib/inbox-resilience.js";

function row(overrides: Partial<TrackedQueueRow> = {}): TrackedQueueRow {
  return {
    jobId: null,
    repositoryKey: "org/repo",
    repository: "org/repo",
    prNumber: 1,
    title: "Example",
    author: "alice",
    headSha: "abc",
    eligibilityReasons: [{ code: "eligible_author" }],
    exclusionReasons: [],
    priority: "p1",
    priorityReasons: [],
    queueOrder: {
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "2026-01-01T00:00:00.000Z",
      normalizedRepositoryIdentity: "org/repo",
      prNumber: 1,
    },
    domains: [],
    attentionState: "needs_analysis",
    jobState: null,
    advisorResult: null,
    discoveredAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("CoverageActionCell", () => {
  it("keeps mutation error visible with an enabled Retry action", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageActionCell, {
        item: row(),
        pending: false,
        refreshing: false,
        actioningElsewhere: false,
        mutationError: "Analyze failed",
        refreshError: undefined,
        onAction: () => {},
        onRefreshRetry: () => {},
      }),
    );

    expect(html).toContain("Analyze failed");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Retry");
    expect(html).not.toContain("disabled");
    expect(html).not.toMatch(/>Analyze</);
  });

  it("preserves analyzing feedback with refresh error and retry refresh control", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageActionCell, {
        item: row({ jobId: "job-1", jobState: "queued" }),
        pending: false,
        refreshing: false,
        actioningElsewhere: false,
        mutationError: undefined,
        refreshError: INBOX_REFRESH_ERROR,
        onAction: () => {},
        onRefreshRetry: () => {},
      }),
    );

    expect(html).toContain(INBOX_REFRESH_ERROR);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Analyzing");
    expect(html).toContain("Refresh");
    expect(html).not.toMatch(/>Analyze</);
    expect(html).not.toMatch(/>Retry</);
  });
});
