import { describe, expect, it } from "vitest";
import { evaluateAutoAnalysis } from "../../src/policy/auto-analyze.js";

describe("evaluateAutoAnalysis", () => {
  it("auto-analyzes explicit review request when enabled", () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: true,
      authorOnly: false,
      selectedTier: "p3",
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ["p0", "p1"],
      },
    });

    expect(result.mode).toBe("auto");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "auto_analyze_explicit_request" }),
      ]),
    );
  });

  it("does NOT auto-analyze explicit request when disabled", () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: true,
      authorOnly: false,
      selectedTier: "p3",
      autoAnalyzeConfig: {
        explicitReviewRequests: false,
        priorityTiers: ["p0", "p1"],
      },
    });

    expect(result.mode).toBe("on_demand");
    expect(result.reasons).toHaveLength(0);
  });

  it("auto-analyzes when selected tier is in priorityTiers", () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: false,
      selectedTier: "p1",
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ["p0", "p1"],
      },
    });

    expect(result.mode).toBe("auto");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "auto_analyze_priority_tier",
          tier: "p1",
        }),
      ]),
    );
  });

  it("on-demand when selected tier is NOT in priorityTiers", () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: false,
      selectedTier: "p3",
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ["p0", "p1"],
      },
    });

    expect(result.mode).toBe("on_demand");
  });

  it("author-only does NOT auto-analyze even if tier would match", () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: true,
      selectedTier: "p3",
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ["p0", "p1", "p2", "p3"],
      },
    });

    expect(result.mode).toBe("on_demand");
  });

  it("author-only CAN auto-analyze when independent priority rule matches", () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: true,
      selectedTier: "p1",
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ["p0", "p1"],
      },
      hasIndependentPriorityMatch: true,
    });

    expect(result.mode).toBe("auto");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "auto_analyze_priority_tier",
          tier: "p1",
        }),
      ]),
    );
  });

  it("unranked (ineligible) can NEVER auto-analyze", () => {
    const result = evaluateAutoAnalysis({
      eligible: false,
      explicitRequest: false,
      authorOnly: false,
      selectedTier: "unranked",
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ["p0", "p1"],
      },
    });

    expect(result.mode).toBe("on_demand");
    expect(result.reasons).toHaveLength(0);
  });

  it("collects multiple auto-analysis reasons when both explicit and tier match", () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: true,
      authorOnly: false,
      selectedTier: "p0",
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ["p0", "p1"],
      },
    });

    expect(result.mode).toBe("auto");
    expect(result.reasons).toHaveLength(2);
  });
});
