import { describe, it, expect } from "vitest";
import { getReviewFallback } from "../../client/src/lib/review-fallback.js";

describe("getReviewFallback", () => {
  it("non-null jobId => retry with Retry Analysis label and draft message", () => {
    expect(getReviewFallback({ jobId: "job-1", jobState: "draft_ready" })).toEqual({
      action: "retry",
      label: "Retry Analysis",
      message: "The draft is not available yet or is no longer current.",
    });
  });

  it("null jobId => analyze with Analyze label and not-started message", () => {
    expect(getReviewFallback({ jobId: null, jobState: null })).toEqual({
      action: "analyze",
      label: "Analyze",
      message: "Analysis has not started for this pull request.",
    });
  });

  it("uses Retry even when the unavailable draft came from a failed job", () => {
    expect(getReviewFallback({ jobId: "job-1", jobState: "failed" }).action).toBe(
      "retry",
    );
  });
});
