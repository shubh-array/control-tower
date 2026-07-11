import { sha256OfCanonicalJson } from '../util/hash.js';
import type { ReplayResult, ReplayCaseResult } from './types.js';

export interface CorpusCase {
  caseId: string;
  input: unknown;
  expected: unknown;
}

export interface EvaluationOutput {
  passed: boolean;
  metricValues: Record<string, number>;
}

export interface ReplayConfig {
  proposalId: string;
  role: 'attention' | 'primaryReview';
  proposedManifest: { harnessManifestHash: string };
  corpusCases: CorpusCase[];
  modelSpec: string;
  evaluator: (output: unknown, expected: unknown) => EvaluationOutput;
}

function hashContent(content: unknown): string {
  return sha256OfCanonicalJson(content);
}

export async function runHistoricalReplay(config: ReplayConfig): Promise<ReplayResult> {
  const corpusInputHash = hashContent(config.corpusCases.map(c => c.input));
  const caseResults: ReplayCaseResult[] = [];
  const aggregateMetrics: Record<string, number[]> = {};

  for (const corpusCase of config.corpusCases) {
    const simulatedOutput = corpusCase.input;
    const evalResult = config.evaluator(simulatedOutput, corpusCase.expected);

    caseResults.push({
      caseId: corpusCase.caseId,
      passed: evalResult.passed,
      output: simulatedOutput,
      metricValues: evalResult.metricValues,
    });

    for (const [key, value] of Object.entries(evalResult.metricValues)) {
      if (!aggregateMetrics[key]) aggregateMetrics[key] = [];
      aggregateMetrics[key].push(value);
    }
  }

  const metrics: Record<string, number> = {};
  for (const [key, values] of Object.entries(aggregateMetrics)) {
    metrics[key] = values.reduce((a, b) => a + b, 0) / values.length;
  }

  return {
    proposalId: config.proposalId,
    role: config.role,
    corpusInputHash,
    manifestHash: config.proposedManifest.harnessManifestHash,
    beforeManifestHash: 'current_baseline',
    afterManifestHash: config.proposedManifest.harnessManifestHash,
    caseResults,
    metrics,
  };
}
