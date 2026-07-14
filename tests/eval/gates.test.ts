// tests/eval/gates.test.ts
import { describe, it, expect } from 'vitest';
import {
  PRIMARY_REVIEW_GATES,
  evaluateGate,
  evaluateAllGates,
} from '../../eval/gates.js';

describe('evaluateGate', () => {
  it('passes eq for exact match', () => {
    const result = evaluateGate('test', 1.0, PRIMARY_REVIEW_GATES.provenanceValidity);
    expect(result.passed).toBe(true);
  });

  it('fails eq when value differs', () => {
    const result = evaluateGate('test', 0.9, PRIMARY_REVIEW_GATES.provenanceValidity);
    expect(result.passed).toBe(false);
  });
});

describe('evaluateAllGates', () => {
  it('returns allPassed when provenance validity meets gate', () => {
    const { allPassed, results } = evaluateAllGates({ provenanceValidity: 1.0 });
    expect(allPassed).toBe(true);
    expect(results).toHaveLength(1);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('returns allPassed=false when provenance gate fails', () => {
    const { allPassed } = evaluateAllGates({ provenanceValidity: 0.5 });
    expect(allPassed).toBe(false);
  });
});
