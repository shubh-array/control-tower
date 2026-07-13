// tests/eval/runner.test.ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  loadCorpus,
  loadCase,
  runPrimaryReviewEval,
} from '../../eval/runner.js';
import type { ReviewRunOutput } from '../../eval/metrics/primary-review.js';

const reviewCorpusPath = join(import.meta.dirname, '../../eval/primary-review/corpus.json');

describe('loadCorpus', () => {
  it('loads primary review corpus definition', () => {
    const corpus = loadCorpus(reviewCorpusPath);
    expect(corpus.role).toBe('primaryReview');
    expect(corpus.cases).toHaveLength(5);
  });
});

describe('runPrimaryReviewEval', () => {
  it('evaluates all review cases with valid provenance', async () => {
    const result = await runPrimaryReviewEval(
      reviewCorpusPath,
      async () => ({
        findings: [],
        observations: [{ provenanceRefs: ['pv_diff_hunk_001'], fileReferences: [] }],
        recommendedDisposition: 'approve',
      } satisfies ReviewRunOutput),
      new Set(['pv_diff_hunk_001', 'pv_diff_hunk_010', 'pv_diff_hunk_020', 'pv_diff_hunk_030', 'pv_diff_hunk_040']),
      new Set(['blob_pagination_001', 'blob_button_001', 'blob_db_001', 'blob_handler_001']),
    );
    expect(result.role).toBe('primaryReview');
    expect(result.caseResults).toHaveLength(5);
  });
});

describe('loadCase', () => {
  it('loads individual case files', () => {
    const corpus = loadCorpus(reviewCorpusPath);
    const basePath = join(reviewCorpusPath, '..');
    const caseData = loadCase(basePath, corpus.cases[0]!) as { caseId: string };
    expect(caseData.caseId).toBeDefined();
  });
});
