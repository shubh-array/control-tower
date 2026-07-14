// client/src/lib/api.ts

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }

  return (await res.json()) as T;
}

export const api = {
  getHealth() {
    return request<{ healthy: boolean; issues: string[] }>("/api/health");
  },

  getQueue() {
    return request<{
      allTracked: TrackedQueueRow[];
      focusQueue: { now: FocusQueueRow[]; next: FocusQueueRow[]; monitor: FocusQueueRow[] };
    }>("/api/queue");
  },

  getJob(jobId: string) {
    return request<JobDetail>(`/api/jobs/${encodeURIComponent(jobId)}`);
  },

  getDraft(jobId: string) {
    return request<DraftDetail>(`/api/drafts/${encodeURIComponent(jobId)}`);
  },

  async createActionToken(): Promise<string> {
    const result = await request<{ token: string }>("/api/action-token", {
      method: "POST",
    });
    return result.token;
  },

  async approveOperation(operationHash: string) {
    const actionToken = await this.createActionToken();
    return request<{ approved: boolean }>("/api/approvals", {
      method: "POST",
      body: JSON.stringify({ operationHash, actionToken }),
    });
  },

  async publishOperation(operationHash: string, body: string | null) {
    const actionToken = await this.createActionToken();
    return request<PublishResult>("/api/publish", {
      method: "POST",
      body: JSON.stringify({ operationHash, body, actionToken }),
    });
  },

  getAudit(jobId: string) {
    return request<AuditEntry[]>(`/api/audit/${encodeURIComponent(jobId)}`);
  },

  async requestAnalyze(input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: "registered-source" | "remote-evidence-only";
  }) {
    const actionToken = await this.createActionToken();
    return request<{ jobId: string }>("/api/jobs/analyze", {
      method: "POST",
      body: JSON.stringify({ ...input, actionToken }),
    });
  },

  async requestRetry(jobId: string) {
    const actionToken = await this.createActionToken();
    return request<{ runId: string }>(
      `/api/jobs/${encodeURIComponent(jobId)}/retry`,
      {
        method: "POST",
        body: JSON.stringify({ actionToken }),
      },
    );
  },

  getSignals(limit = 50) {
    return request<LearningSignalSummary[]>(`/api/signals?limit=${limit}`);
  },

  async startProposal(signalRunIds: string[]) {
    const actionToken = await this.createActionToken();
    return request<ProposalDetail>("/api/proposals/start", {
      method: "POST",
      body: JSON.stringify({ signalRunIds, actionToken }),
    });
  },

  async validateProposal(proposalId: string) {
    const actionToken = await this.createActionToken();
    return request<ProposalValidationResult>(
      `/api/proposals/${encodeURIComponent(proposalId)}/validate`,
      {
        method: "POST",
        body: JSON.stringify({ actionToken }),
      },
    );
  },

  async adoptProposal(proposalId: string) {
    const actionToken = await this.createActionToken();
    return request<ProposalAdoptionResult>(
      `/api/proposals/${encodeURIComponent(proposalId)}/adopt`,
      {
        method: "POST",
        body: JSON.stringify({ actionToken }),
      },
    );
  },
};

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

export interface RunSummary {
  runId: string;
  attemptNumber: number;
  state: string;
  startedAt: string;
  completedAt: string | null;
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

export interface OperationPlanSummary {
  draftSummaryUse: string;
  operations: { type: string; event: string | null; operationHash: string }[];
}

export interface PublishResult {
  status: "completed" | "failed";
  error?: string;
}

export interface AuditEntry {
  timestamp: string;
  event: string;
  details: Record<string, unknown>;
}

export interface LearningSignalSummary {
  type: string;
  jobId: string;
  runId: string;
  timestamp: string;
  modelRole: string;
}

export interface ProposalDetail {
  id: string;
  status: string;
  targets: Array<{
    path: string;
    rationale: string;
    proposedContent: string;
    baseContentHash: string;
  }>;
}

export interface ProposalValidationResult {
  valid: boolean;
  errors: string[];
  previews?: ProposalPreview[];
}

export interface ProposalPreviewLine {
  type: "unchanged" | "added" | "removed";
  lineNumber: number;
  content: string;
}

export interface ProposalPreview {
  proposalId: string;
  targetPath: string;
  baseHash: string;
  proposedHash: string;
  lines: ProposalPreviewLine[];
}

export interface ProposalAdoptionResult {
  adopted: boolean;
  errors: string[];
}
