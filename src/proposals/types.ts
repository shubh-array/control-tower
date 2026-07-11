
export const PROPOSAL_TARGET_ALLOWLIST = [
  'policy.json',
  'persona.md',
  'harnesses/<feature>/prompt.md',
  'harnesses/<feature>/skills/<skill>/SKILL.md',
] as const;

export const MAX_PROPOSAL_TARGETS = 4;
export const MAX_PROPOSAL_SIZE_BYTES = 1024 * 1024; // 1 MiB
export const MAX_PER_FILE_SIZE_BYTES = 256 * 1024;  // 256 KiB

const ALLOWED_PATTERNS = [
  /^policy\.json$/,
  /^persona\.md$/,
  /^harnesses\/[a-z][a-z0-9-]*\/prompt\.md$/,
  /^harnesses\/[a-z][a-z0-9-]*\/skills\/[a-z][a-z0-9-]*\/SKILL\.md$/,
];

export function isAllowedTarget(path: string): boolean {
  return ALLOWED_PATTERNS.some(pattern => pattern.test(path));
}

export interface ProposalTarget {
  path: string;
  baseContentHash: string;
  proposedContent: string;
  rationale: string;
  expectedEffect: string;
  risks: string[];
  replayCases: string[];
}

export interface ProfileChangeProposal {
  id: string;
  version: number;
  createdAt: string;
  selectedSignalHash: string;
  targetBaseContentHashes: Record<string, string>;
  immutableProposalContractHash: string;
  personaHash: string;
  modelSpecHash: string;
  targets: ProposalTarget[];
  status: 'pending_validation' | 'validated' | 'replay_complete' | 'previewed' | 'adopted' | 'rejected' | 'stale';
}

export interface ProposalValidationResult {
  valid: boolean;
  errors: string[];
  targetValidation: Record<string, { allowed: boolean; schemaValid: boolean; baseHashMatch: boolean }>;
}

export interface ReplayResult {
  proposalId: string;
  role: 'attention' | 'primaryReview';
  corpusInputHash: string;
  manifestHash: string;
  beforeManifestHash: string;
  afterManifestHash: string;
  caseResults: ReplayCaseResult[];
  metrics: Record<string, number>;
}

export interface ReplayCaseResult {
  caseId: string;
  passed: boolean;
  output: unknown;
  metricValues: Record<string, number>;
}
