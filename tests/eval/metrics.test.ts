// tests/eval/metrics.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeMustEscalateRecall,
  computeFalseEscalationRate,
  computeJaccardTop3,
  computeJaccardTop3Stability,
  type AttentionRunOutput,
} from '../../eval/metrics/attention';
import {
  computeProvenanceValidity,
  computeFindingRecall,
  computeFalsePositiveRate,
  type ReviewRunOutput,
} from '../../eval/metrics/primary-review';

describe('attention metrics', () => {
  const output: AttentionRunOutput = {
    items: [
      { repositoryKey: 'webapp', prNumber: 10, relevance: 'critical', risk: 'high', recommendedAction: 'review' },
      { repositoryKey: 'docs', prNumber: 5, relevance: 'low', risk: 'low', recommendedAction: 'monitor' },
    ],
  };

  it('computes mustEscalate recall', () => {
    const recall = computeMustEscalateRecall(output, { mustEscalate: ['webapp#10'] });
    expect(recall).toBe(1.0);
  });

  it('computes false escalation rate', () => {
    const rate = computeFalseEscalationRate(output, { forbiddenEscalation: ['docs#5'] });
    expect(rate).toBe(0.0);
  });

  it('computes jaccard top3 between runs', () => {
    const jaccard = computeJaccardTop3(['a', 'b', 'c'], ['b', 'c', 'd']);
    expect(jaccard).toBeCloseTo(0.5);
  });

  it('returns 1.0 jaccard stability for single run', () => {
    expect(computeJaccardTop3Stability([['a', 'b']])).toBe(1.0);
  });
});

describe('primary review metrics', () => {
  const output: ReviewRunOutput = {
    findings: [{ title: 'Off-by-one in end index', provenanceRefs: ['pv_001'], fileReferences: [] }],
    observations: [
      {
        provenanceRefs: ['pv_001'],
        fileReferences: [{ path: 'src/a.ts', blobSha: 'blob_abc', startLine: 1, endLine: 5 }],
      },
    ],
    recommendedDisposition: 'comment',
  };

  it('computes provenance validity', () => {
    const validity = computeProvenanceValidity(
      output,
      new Set(['pv_001']),
      new Set(['blob_abc']),
    );
    expect(validity).toBe(1.0);
  });

  it('computes finding recall', () => {
    const recall = computeFindingRecall(output, { requiredFindings: ['off-by-one'], provenanceValid: true });
    expect(recall).toBe(1.0);
  });

  it('computes false positive rate', () => {
    const rate = computeFalsePositiveRate(output, { forbiddenClaims: ['vulnerability'], provenanceValid: true });
    expect(rate).toBe(0.0);
  });
});
