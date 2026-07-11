// tests/eval/gates.test.ts
import { describe, it, expect } from 'vitest';
import {
  ATTENTION_GATES,
  PRIMARY_REVIEW_GATES,
  evaluateGate,
  evaluateAllGates,
} from '../../eval/gates';

describe('evaluateGate', () => {
  it('passes gte when value meets threshold', () => {
    const result = evaluateGate('test', 0.95, ATTENTION_GATES.mustEscalateRecall);
    expect(result.passed).toBe(true);
  });

  it('fails gte when value is below threshold', () => {
    const result = evaluateGate('test', 0.85, ATTENTION_GATES.mustEscalateRecall);
    expect(result.passed).toBe(false);
  });

  it('passes lte when value is at or below threshold', () => {
    const result = evaluateGate('test', 0.05, ATTENTION_GATES.falseEscalationRate);
    expect(result.passed).toBe(true);
  });

  it('passes eq for exact match', () => {
    const result = evaluateGate('test', 1.0, PRIMARY_REVIEW_GATES.provenanceValidity);
    expect(result.passed).toBe(true);
  });
});

describe('evaluateAllGates', () => {
  it('returns allPassed when all metrics meet gates', () => {
    const { allPassed, results } = evaluateAllGates(
      { mustEscalateRecall: 0.95, falseEscalationRate: 0.05, jaccardTop3Stability: 0.85 },
      { provenanceValidity: 1.0 },
    );
    expect(allPassed).toBe(true);
    expect(results).toHaveLength(4);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('returns allPassed=false when any gate fails', () => {
    const { allPassed } = evaluateAllGates(
      { mustEscalateRecall: 0.5, falseEscalationRate: 0.05, jaccardTop3Stability: 0.85 },
      { provenanceValidity: 1.0 },
    );
    expect(allPassed).toBe(false);
  });
});
