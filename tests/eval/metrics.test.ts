// tests/eval/metrics.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeProvenanceValidity,
  computeFindingRecall,
  computeFalsePositiveRate,
  type ReviewRunOutput,
} from '../../eval/metrics/primary-review.js';

describe('primary review metrics', () => {
  const output: ReviewRunOutput = {
    findings: [{ title: 'Off-by-one in end index', provenanceRefs: ['pv_001'], fileReferences: [] }],
    observations: [
      {
        provenanceRefs: ['pv_001'],
        fileReferences: [{ path: 'src/a.ts', blobSha: 'blob_abc' }],
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
