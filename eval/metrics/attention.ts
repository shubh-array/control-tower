
export interface AttentionCaseExpectation {
  mustEscalate?: string[];
  forbiddenEscalation?: string[];
  acceptableActions?: string[];
}

export interface AttentionRunOutput {
  items: Array<{
    repositoryKey: string;
    prNumber: number;
    relevance: string;
    risk: string;
    recommendedAction: string;
  }>;
}

export function computeMustEscalateRecall(
  output: AttentionRunOutput,
  expected: AttentionCaseExpectation,
): number {
  if (!expected.mustEscalate || expected.mustEscalate.length === 0) return 1.0;
  const escalated = output.items
    .filter(i => i.relevance === 'critical' || i.relevance === 'high')
    .map(i => `${i.repositoryKey}#${i.prNumber}`);
  const hits = expected.mustEscalate.filter(e => escalated.includes(e));
  return hits.length / expected.mustEscalate.length;
}

export function computeFalseEscalationRate(
  output: AttentionRunOutput,
  expected: AttentionCaseExpectation,
): number {
  if (!expected.forbiddenEscalation || expected.forbiddenEscalation.length === 0) return 0.0;
  const escalated = output.items
    .filter(i => i.relevance === 'critical' || i.relevance === 'high')
    .map(i => `${i.repositoryKey}#${i.prNumber}`);
  const falseHits = expected.forbiddenEscalation.filter(e => escalated.includes(e));
  return falseHits.length / expected.forbiddenEscalation.length;
}

export function computeJaccardTop3(runA: string[], runB: string[]): number {
  const setA = new Set(runA.slice(0, 3));
  const setB = new Set(runB.slice(0, 3));
  const intersection = [...setA].filter(x => setB.has(x));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 1.0;
  return intersection.length / union.size;
}

export function computeJaccardTop3Stability(repeatedRuns: string[][]): number {
  if (repeatedRuns.length < 2) return 1.0;
  let totalJaccard = 0;
  let pairs = 0;
  for (let i = 0; i < repeatedRuns.length; i++) {
    for (let j = i + 1; j < repeatedRuns.length; j++) {
      totalJaccard += computeJaccardTop3(repeatedRuns[i], repeatedRuns[j]);
      pairs++;
    }
  }
  return totalJaccard / pairs;
}
