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
  reviewMetrics: { provenanceValidity: number },
): { allPassed: boolean; results: GateResult[] } {
  const results: GateResult[] = [
    evaluateGate('primaryReview.provenanceValidity', reviewMetrics.provenanceValidity, PRIMARY_REVIEW_GATES.provenanceValidity),
  ];
  return { allPassed: results.every(r => r.passed), results };
}
