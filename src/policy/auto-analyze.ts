import type { PriorityTier, PriorityStatus, AnalysisMode } from "../github/types.js";
import type { AutoAnalyzeReason } from "./reasons.js";

export interface AutoAnalyzeConfig {
  explicitReviewRequests: boolean;
  priorityTiers: PriorityTier[];
}

export interface AutoAnalyzeInput {
  eligible: boolean;
  explicitRequest: boolean;
  authorOnly: boolean;
  selectedTier: PriorityStatus;
  autoAnalyzeConfig: AutoAnalyzeConfig;
  hasIndependentPriorityMatch?: boolean;
}

export interface AutoAnalyzeResult {
  mode: AnalysisMode;
  reasons: AutoAnalyzeReason[];
}

export function evaluateAutoAnalysis(input: AutoAnalyzeInput): AutoAnalyzeResult {
  const reasons: AutoAnalyzeReason[] = [];

  if (!input.eligible || input.selectedTier === "unranked") {
    return { mode: "on_demand", reasons };
  }

  if (input.explicitRequest && input.autoAnalyzeConfig.explicitReviewRequests) {
    reasons.push({ code: "auto_analyze_explicit_request" });
  }

  const tierAutoAnalyze = input.autoAnalyzeConfig.priorityTiers.includes(
    input.selectedTier,
  );

  if (tierAutoAnalyze) {
    if (input.authorOnly && !input.hasIndependentPriorityMatch) {
      return {
        mode: reasons.length > 0 ? "auto" : "on_demand",
        reasons,
      };
    }

    reasons.push({
      code: "auto_analyze_priority_tier",
      tier: input.selectedTier,
    });
  }

  return {
    mode: reasons.length > 0 ? "auto" : "on_demand",
    reasons,
  };
}
