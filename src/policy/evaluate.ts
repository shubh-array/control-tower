import type {
  AnalysisMode,
  DiscoveredPr,
  PriorityStatus,
} from "../github/types.js";
import type { RepositoryPolicy } from "../config/types.js";
import {
  evaluateAutoAnalysis,
  type AutoAnalyzeConfig,
  type AutoAnalyzeResult,
} from "./auto-analyze.js";
import {
  evaluateEligibility,
  type EligibilityResult,
} from "./eligibility.js";
import { evaluatePriority, type PriorityResult } from "./priority.js";
import { selectDomains, type DomainResult } from "./domains.js";
import type {
  AutoAnalyzeReason,
  DomainMatchReason,
  EligibilityReason,
  ExclusionReason,
  PriorityReason,
  SelectedDomain,
} from "./reasons.js";

export interface PolicyInput {
  pr: DiscoveredPr;
  activeRepositoryIds: string[];
  repositoryPolicy: RepositoryPolicy | null;
  autoAnalyzeConfig: AutoAnalyzeConfig;
  operatorLogin: string;
}

export interface PolicyDecision {
  eligible: boolean;
  eligibilityReasons: EligibilityReason[];
  exclusionReasons: ExclusionReason[];
  authorOnly: boolean;
  priorityStatus: PriorityStatus;
  prioritySortOrdinal: number;
  priorityReasons: PriorityReason[];
  allPriorityReasons: PriorityReason[];
  selectedPriorityReason: PriorityReason | null;
  analysisMode: AnalysisMode;
  autoAnalyzeReasons: AutoAnalyzeReason[];
  selectedDomains: SelectedDomain[];
  allDomainReasons: DomainMatchReason[];
}

export interface CheckSummaryEntry {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface AllTrackedItem {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: CheckSummaryEntry[];
  updatedAt: string | null;
  explicitRequestTimestamp: string | null;
  policy: PolicyDecision;
  sourceMode: "registered-source" | "remote-evidence-only";
  bodyTruncated: string;
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const repositoryPolicy = input.repositoryPolicy;
  const isActive = input.activeRepositoryIds.includes(input.pr.repositoryId);

  const eligibility: EligibilityResult = evaluateEligibility({
    explicitRequest: input.pr.explicitRequest,
    activeRepository: isActive,
    repositoryId: input.pr.repositoryId || null,
    githubOwnerRepo: input.pr.githubOwnerRepo,
    changedFiles: input.pr.changedFiles,
    authorLogin: input.pr.authorLogin,
    eligiblePaths: repositoryPolicy?.eligiblePaths ?? [],
    eligibleAuthors: repositoryPolicy?.eligibleAuthors ?? [],
    operatorLogin: input.operatorLogin,
  });

  const exclusionCodes = eligibility.exclusions.map((reason) => reason.code);

  const priority: PriorityResult = evaluatePriority({
    eligible: eligibility.eligible,
    exclusionCodes,
    changedFiles: input.pr.changedFiles,
    priorityRules: repositoryPolicy?.priorityRules ?? [],
  });

  const domains: DomainResult = eligibility.eligible
    ? selectDomains({
        changedFiles: input.pr.changedFiles,
        domainRules: repositoryPolicy?.domainRules ?? [],
      })
    : { selected: [], allReasons: [] };

  const hasIndependentPriorityMatch =
    eligibility.authorOnly &&
    priority.allMatchingReasons.some((reason) => reason.code === "priority_rule");

  const autoAnalysis: AutoAnalyzeResult = evaluateAutoAnalysis({
    eligible: eligibility.eligible,
    explicitRequest: input.pr.explicitRequest,
    authorOnly: eligibility.authorOnly,
    selectedTier: priority.status,
    autoAnalyzeConfig: input.autoAnalyzeConfig,
    hasIndependentPriorityMatch,
  });

  return {
    eligible: eligibility.eligible,
    eligibilityReasons: eligibility.reasons,
    exclusionReasons: eligibility.exclusions,
    authorOnly: eligibility.authorOnly,
    priorityStatus: priority.status,
    prioritySortOrdinal: priority.sortOrdinal,
    priorityReasons: priority.reasons,
    allPriorityReasons: priority.allMatchingReasons,
    selectedPriorityReason: priority.selectedReason,
    analysisMode: autoAnalysis.mode,
    autoAnalyzeReasons: autoAnalysis.reasons,
    selectedDomains: domains.selected,
    allDomainReasons: domains.allReasons,
  };
}
