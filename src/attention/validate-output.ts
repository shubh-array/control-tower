const VALID_RELEVANCE = new Set(['critical', 'high', 'medium', 'low', 'unknown']);
const VALID_RISK = new Set(['critical', 'high', 'medium', 'low', 'unknown']);
const VALID_ACTION = new Set(['analyze_now', 'analyze_on_demand', 'monitor', 'human_triage']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

const FORBIDDEN_KEYS = new Set([
  'rank', 'batchRank', 'position', 'order', 'priority',
  'enqueueAnalysis', 'authorizeAnalysis', 'autoAnalyze',
]);

export interface AttentionOutputItem {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  relevance: string;
  risk: string;
  explanation: string;
  recommendedAction: string;
  confidence: string;
  unknowns: string[];
  [key: string]: unknown;
}

export interface AttentionValidationInput {
  candidates: Array<{
    repositoryKey: string;
    prNumber: number;
    headSha: string;
  }>;
}

export interface AttentionValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAttentionOutput(
  output: { schemaVersion: number; items: AttentionOutputItem[] },
  input: AttentionValidationInput,
): AttentionValidationResult {
  const errors: string[] = [];

  if (output.schemaVersion !== 1) {
    errors.push(`invalid schemaVersion: expected 1, got ${output.schemaVersion}`);
  }

  if (!Array.isArray(output.items)) {
    errors.push('items must be an array');
    return { valid: false, errors };
  }

  const candidateKeys = new Set(
    input.candidates.map(c => `${c.repositoryKey}#${c.prNumber}#${c.headSha}`),
  );
  const outputKeys = new Set<string>();

  for (const item of output.items) {
    const key = `${item.repositoryKey}#${item.prNumber}#${item.headSha}`;

    for (const forbidden of FORBIDDEN_KEYS) {
      if (forbidden in item) {
        errors.push(`forbidden field '${forbidden}' in item ${item.repositoryKey}#${item.prNumber}`);
      }
    }

    if (!candidateKeys.has(key)) {
      errors.push(`extra item not in input candidates: ${item.repositoryKey}#${item.prNumber}`);
      continue;
    }
    if (outputKeys.has(key)) {
      errors.push(`duplicate item: ${item.repositoryKey}#${item.prNumber}`);
    }
    outputKeys.add(key);

    if (!VALID_RELEVANCE.has(item.relevance)) {
      errors.push(`invalid relevance '${item.relevance}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!VALID_RISK.has(item.risk)) {
      errors.push(`invalid risk '${item.risk}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!VALID_ACTION.has(item.recommendedAction)) {
      errors.push(`invalid recommendedAction '${item.recommendedAction}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!VALID_CONFIDENCE.has(item.confidence)) {
      errors.push(`invalid confidence '${item.confidence}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (typeof item.explanation !== 'string' || item.explanation.length > 1000) {
      errors.push(`explanation exceeds 1000 chars for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!Array.isArray(item.unknowns) || item.unknowns.length > 10) {
      errors.push(`unknowns exceeds 10 entries for ${item.repositoryKey}#${item.prNumber}`);
    }
  }

  for (const candidate of input.candidates) {
    const key = `${candidate.repositoryKey}#${candidate.prNumber}#${candidate.headSha}`;
    if (!outputKeys.has(key)) {
      errors.push(`missing output for candidate ${candidate.repositoryKey}#${candidate.prNumber}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
