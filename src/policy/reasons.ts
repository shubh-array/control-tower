export interface ExplicitRequestReason {
  code: 'explicit_review_request';
  requestedLogin: string;
}

export interface EligiblePathReason {
  code: 'eligible_path';
  repositoryId: string;
  matchedPath: string;
  matchedRule: string;
}

export interface EligibleAuthorReason {
  code: 'eligible_author';
  repositoryId: string;
  normalizedLogin: string;
}

export type EligibilityReason =
  | ExplicitRequestReason
  | EligiblePathReason
  | EligibleAuthorReason;

export interface InactiveRepositoryExclusion {
  code: 'inactive_repository';
  repositoryId?: string;
  githubOwnerRepo: string;
}

export interface NoMatchExclusion {
  code: 'no_eligible_path_or_author_match';
  repositoryId: string;
}

export interface IsDraftExclusion {
  code: 'is_draft';
}

export type ExclusionReason =
  | InactiveRepositoryExclusion
  | NoMatchExclusion
  | IsDraftExclusion;

export interface DefaultPriorityReason {
  code: 'default_priority';
  tier: 'p3';
}

export interface PriorityRuleReason {
  code: 'priority_rule';
  tier: string;
  declarationIndex: number;
  matchedPath: string;
  matchedRule: string;
}

export interface UnrankedReason {
  code: 'unranked_ineligible';
  eligibilityExclusionCodes: string[];
}

export type PriorityReason =
  | DefaultPriorityReason
  | PriorityRuleReason
  | UnrankedReason;

export interface DomainMatchReason {
  code: 'domain_rule';
  domain: string;
  numericPriority: number;
  declarationIndex: number;
  matchedPath: string;
  matchedRule: string;
}

export interface AutoAnalyzeExplicitReason {
  code: 'auto_analyze_explicit_request';
}

export interface AutoAnalyzePriorityTierReason {
  code: 'auto_analyze_priority_tier';
  tier: string;
}

export type AutoAnalyzeReason =
  | AutoAnalyzeExplicitReason
  | AutoAnalyzePriorityTierReason;

export interface SelectedDomain {
  domain: string;
  selectedPriority: number;
  selectedDeclarationIndex: number;
  matchedPaths: string[];
  allReasons: DomainMatchReason[];
}
