export const ATTENTION_GATES = {
  mustEscalateRecall: { threshold: 0.90, operator: 'gte' as const },
  falseEscalationRate: { threshold: 0.10, operator: 'lte' as const },
  jaccardTop3Stability: { threshold: 0.80, operator: 'gte' as const },
} as const;

export const PRIMARY_REVIEW_GATES = {
  provenanceValidity: { threshold: 1.0, operator: 'eq' as const },
} as const;

export type GateOperator = 'gte' | 'lte' | 'eq';

export interface GateDefinition {
  threshold: number;
  operator: GateOperator;
}

export interface GateResult {
  gate: string;
  value: number;
  threshold: number;
  operator: GateOperator;
  passed: boolean;
}

export function evaluateGate(name: string, value: number, definition: GateDefinition): GateResult {
  let passed: boolean;
  switch (definition.operator) {
    case 'gte': passed = value >= definition.threshold; break;
    case 'lte': passed = value <= definition.threshold; break;
    case 'eq': passed = value === definition.threshold; break;
  }
  return { gate: name, value, threshold: definition.threshold, operator: definition.operator, passed };
}

export function evaluateAllGates(
  attentionMetrics: { mustEscalateRecall: number; falseEscalationRate: number; jaccardTop3Stability: number },
  reviewMetrics: { provenanceValidity: number },
): { allPassed: boolean; results: GateResult[] } {
  const results: GateResult[] = [
    evaluateGate('attention.mustEscalateRecall', attentionMetrics.mustEscalateRecall, ATTENTION_GATES.mustEscalateRecall),
    evaluateGate('attention.falseEscalationRate', attentionMetrics.falseEscalationRate, ATTENTION_GATES.falseEscalationRate),
    evaluateGate('attention.jaccardTop3Stability', attentionMetrics.jaccardTop3Stability, ATTENTION_GATES.jaccardTop3Stability),
    evaluateGate('primaryReview.provenanceValidity', reviewMetrics.provenanceValidity, PRIMARY_REVIEW_GATES.provenanceValidity),
  ];
  return { allPassed: results.every(r => r.passed), results };
}
