/**
 * Loopback API contract types — must stay aligned with `client/src/lib/api.ts`.
 * Projections in `src/api/projections/` map facade/DB shapes to these types.
 */

export interface EligibilityReason {
  code: string;
  [key: string]: unknown;
}

export interface ExclusionReason {
  code: string;
  detail?: string;
  [key: string]: unknown;
}

export interface PriorityReason {
  code: string;
  tier?: string;
  [key: string]: unknown;
}

export interface AdvisorResult {
  relevance: string;
  risk: string;
  explanation: string;
  recommendedAction: string;
  confidence: string;
  unknowns: string[];
  stale: boolean;
}

/** Client queue row — flat projection of AllTrackedItem + DB enrichment. */
export interface QueueOrder {
  prioritySortOrdinal: number;
  explicitRequestSort: 0 | 1;
  queueTimestamp: string;
  normalizedRepositoryIdentity: string;
  prNumber: number;
}

export interface TrackedQueueRow {
  jobId: string | null;
  repositoryKey: string;
  repository: string;
  prNumber: number;
  title: string;
  url: string;
  author: string;
  headSha: string;
  eligibilityReasons: EligibilityReason[];
  exclusionReasons: ExclusionReason[];
  priority: string;
  priorityReasons: PriorityReason[];
  queueOrder: QueueOrder;
  domains: string[];
  attentionState: string;
  jobState: string | null;
  advisorResult: AdvisorResult | null;
  discoveredAt: string;
  updatedAt: string;
}

export type FocusQueueRow = TrackedQueueRow;

export interface RunSummary {
  runId: string;
  attemptNumber: number;
  state: string;
  startedAt: string;
  completedAt: string | null;
}

export interface JobDetail {
  jobId: string;
  repository: string;
  prNumber: number;
  headSha: string;
  state: string;
  sourceMode: string;
  runs: RunSummary[];
  acceptedRunId: string | null;
}

export interface OperationPlanSummary {
  draftSummaryUse: string;
  operations: { type: string; event: string | null; operationHash: string }[];
}

export interface DraftDetail {
  jobId: string;
  runId: string;
  summary: {
    intent: string;
    implementation: string;
  };
  draftSummary: {
    body: string;
    observationIndexes: number[];
    provenanceRefs: string[];
  };
  findings: Finding[];
  observations: Observation[];
  checks: CheckResult[];
  coverage: CoverageInfo;
  unknowns: string[];
  recommendedDisposition: string;
  validatedProvenance: Record<string, unknown>[];
  operationPlan: OperationPlanSummary | null;
  reviewedHeadSha: string;
  currentHeadSha: string;
  stale: boolean;
}

export interface Finding {
  severity: string;
  confidence: string;
  title: string;
  rationale: string;
  file: string;
  location: {
    side: string;
    line: number;
    startSide: string | null;
    startLine: number | null;
  } | null;
  draftComment: string;
  observationIndexes: number[];
}

export interface Observation {
  type: string;
  statement: string;
  provenanceRefs: string[];
}

export interface CheckResult {
  name: string;
  status: string;
  provenanceRef: string;
}

export interface CoverageInfo {
  mode: string;
  sourceTreeInspected: boolean;
  diffFiltered: boolean;
  omittedProtectedPaths: string[];
  missingCoverage: string[];
}
