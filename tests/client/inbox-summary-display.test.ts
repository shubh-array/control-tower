import { describe, it, expect } from "vitest";
import {
  buildSecondaryPipelineStats,
  formatInboxSubtitle,
  formatLastSynced,
} from "../../client/src/lib/inbox-summary-display.js";
import type { InboxSummary } from "../../client/src/lib/api.js";

const summary: InboxSummary = {
  readyToReview: 2,
  explicitRequests: 3,
  totalEligible: 8,
  needsAnalysis: 4,
  analyzing: 1,
  failed: 1,
  stale: 1,
  lastPollTimestamp: "2026-07-10T12:00:00.000Z",
};

describe("inbox summary display", () => {
  it("formats the page subtitle from primary counters", () => {
    expect(formatInboxSubtitle(summary)).toBe(
      "2 ready · 3 explicit requests · 8 eligible",
    );
  });

  it("formats last synced fallback states", () => {
    expect(formatLastSynced(null)).toBe("Last synced: not yet");
    expect(formatLastSynced("not-a-date")).toBe("Last synced: unknown");
  });

  it("includes only non-zero pipeline stats in the secondary row", () => {
    expect(buildSecondaryPipelineStats(summary).map((stat) => stat.key)).toEqual([
      "needs-analysis",
      "analyzing",
      "failed",
      "stale",
    ]);

    expect(
      buildSecondaryPipelineStats({
        ...summary,
        needsAnalysis: 0,
        analyzing: 0,
        failed: 0,
        stale: 0,
      }),
    ).toEqual([]);
  });
});
