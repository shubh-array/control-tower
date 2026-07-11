import { createHash } from "node:crypto";
import type { PolicyDecision } from "../policy/evaluate.js";
import { sha256OfCanonicalJson } from "../util/hash.js";

export interface JobIdentityInput {
  role: "primaryReview";
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  sourceMode: "registered-source" | "remote-evidence-only";
  policyDecisionHash: string;
}

/**
 * Canonical hash over matcher version + eligibility/priority/auto-analysis/
 * domain reasons + the review-relevant policy subset (spec §10.5).
 * Uses plan 02's flat PolicyDecision — never a nested eligibility/priority object.
 */
export function computePolicyDecisionHash(input: {
  matcherVersion: number;
  decision: PolicyDecision;
  reviewRelevantPolicySubset: unknown;
}): string {
  return sha256OfCanonicalJson({
    matcherVersion: input.matcherVersion,
    eligible: input.decision.eligible,
    eligibilityReasons: input.decision.eligibilityReasons,
    exclusionReasons: input.decision.exclusionReasons,
    priorityStatus: input.decision.priorityStatus,
    prioritySortOrdinal: input.decision.prioritySortOrdinal,
    selectedPriorityReason: input.decision.selectedPriorityReason,
    allPriorityReasons: input.decision.allPriorityReasons,
    analysisMode: input.decision.analysisMode,
    autoAnalyzeReasons: input.decision.autoAnalyzeReasons,
    selectedDomains: input.decision.selectedDomains,
    allDomainReasons: input.decision.allDomainReasons,
    reviewRelevantPolicySubset: input.reviewRelevantPolicySubset,
  });
}

export function computeJobIdentity(input: JobIdentityInput): string {
  const preimage = [
    `role=${input.role}`,
    `repo=${input.repositoryKey}`,
    `pr=${input.prNumber}`,
    `head=${input.headSha}`,
    `sourceMode=${input.sourceMode}`,
    `policyDecision=${input.policyDecisionHash}`,
  ].join("\n");

  return createHash("sha256").update(preimage).digest("hex");
}
