import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateAllGates, type GateResult } from './gates.js';
import {
  computeMustEscalateRecall,
  computeFalseEscalationRate,
  computeJaccardTop3Stability,
  type AttentionRunOutput,
  type AttentionCaseExpectation,
} from './metrics/attention.js';
import {
  computeProvenanceValidity,
  type ReviewRunOutput,
  type ReviewCaseExpectation,
} from './metrics/primary-review.js';

export interface CorpusDefinition {
  schemaVersion: number;
  role: 'attention' | 'primaryReview';
  cases: string[];
  gates: Record<string, { threshold: number; operator: string }>;
  stabilityRepeats?: number;
}

export interface EvalRunResult {
  role: string;
  corpusHash: string;
  caseResults: CaseEvalResult[];
  aggregateMetrics: Record<string, number>;
  gateResults: GateResult[];
  allGatesPassed: boolean;
}

export interface CaseEvalResult {
  caseId: string;
  passed: boolean;
  metrics: Record<string, number>;
  errors: string[];
}

export function loadCorpus(corpusPath: string): CorpusDefinition {
  const raw = readFileSync(corpusPath, 'utf-8');
  return JSON.parse(raw);
}

export function loadCase(basePath: string, casePath: string): unknown {
  const raw = readFileSync(join(basePath, casePath), 'utf-8');
  return JSON.parse(raw);
}

export async function runAttentionEval(
  corpusPath: string,
  executor: (input: unknown) => Promise<AttentionRunOutput>,
): Promise<EvalRunResult> {
  const corpus = loadCorpus(corpusPath);
  const basePath = join(corpusPath, '..');
  const caseResults: CaseEvalResult[] = [];
  const recallValues: number[] = [];
  const falseEscValues: number[] = [];
  const repeatedTopSets: string[][] = [];

  for (const caseDef of corpus.cases) {
    const caseData = loadCase(basePath, caseDef) as { caseId: string; input: unknown; expected: AttentionCaseExpectation };
    const output = await executor(caseData.input);
    const recall = computeMustEscalateRecall(output, caseData.expected);
    const falseEsc = computeFalseEscalationRate(output, caseData.expected);
    recallValues.push(recall);
    falseEscValues.push(falseEsc);

    const topItems = output.items
      .filter(i => i.relevance === 'critical' || i.relevance === 'high')
      .slice(0, 3)
      .map(i => `${i.repositoryKey}#${i.prNumber}`);
    repeatedTopSets.push(topItems);

    caseResults.push({
      caseId: caseData.caseId,
      passed: recall >= 0.9 && falseEsc <= 0.1,
      metrics: { mustEscalateRecall: recall, falseEscalationRate: falseEsc },
      errors: [],
    });
  }

  const avgRecall = recallValues.reduce((a, b) => a + b, 0) / (recallValues.length || 1);
  const avgFalseEsc = falseEscValues.reduce((a, b) => a + b, 0) / (falseEscValues.length || 1);
  const jaccard = computeJaccardTop3Stability(repeatedTopSets);

  const { allPassed, results: gateResults } = evaluateAllGates(
    { mustEscalateRecall: avgRecall, falseEscalationRate: avgFalseEsc, jaccardTop3Stability: jaccard },
    { provenanceValidity: 1.0 },
  );

  return {
    role: 'attention',
    corpusHash: 'corpus_attention',
    caseResults,
    aggregateMetrics: { mustEscalateRecall: avgRecall, falseEscalationRate: avgFalseEsc, jaccardTop3Stability: jaccard },
    gateResults,
    allGatesPassed: allPassed,
  };
}

export async function runPrimaryReviewEval(
  corpusPath: string,
  executor: (input: unknown) => Promise<ReviewRunOutput>,
  provenanceCatalog: Set<string>,
  blobCatalog: Set<string>,
): Promise<EvalRunResult> {
  const corpus = loadCorpus(corpusPath);
  const basePath = join(corpusPath, '..');
  const caseResults: CaseEvalResult[] = [];
  const provenanceValidities: number[] = [];

  for (const caseDef of corpus.cases) {
    const caseData = loadCase(basePath, caseDef) as { caseId: string; input: unknown; expected: ReviewCaseExpectation };
    const output = await executor(caseData.input);
    const provValidity = computeProvenanceValidity(output, provenanceCatalog, blobCatalog);
    provenanceValidities.push(provValidity);

    const errors: string[] = [];
    if (provValidity < 1.0) {
      errors.push(`Provenance validity ${provValidity} < 1.0 (hard gate failure)`);
    }

    caseResults.push({
      caseId: caseData.caseId,
      passed: provValidity === 1.0,
      metrics: { provenanceValidity: provValidity },
      errors,
    });
  }

  const avgProvenance = provenanceValidities.reduce((a, b) => a + b, 0) / (provenanceValidities.length || 1);

  const { allPassed, results: gateResults } = evaluateAllGates(
    { mustEscalateRecall: 1.0, falseEscalationRate: 0.0, jaccardTop3Stability: 1.0 },
    { provenanceValidity: avgProvenance },
  );

  return {
    role: 'primaryReview',
    corpusHash: 'corpus_primary_review',
    caseResults,
    aggregateMetrics: { provenanceValidity: avgProvenance },
    gateResults,
    allGatesPassed: allPassed,
  };
}
