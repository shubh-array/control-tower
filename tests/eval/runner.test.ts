// tests/eval/runner.test.ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  loadCorpus,
  loadCase,
  runAttentionEval,
  runPrimaryReviewEval,
} from '../../eval/runner.js';
import type { AttentionRunOutput } from '../../eval/metrics/attention.js';
import type { ReviewRunOutput } from '../../eval/metrics/primary-review.js';

const attentionCorpusPath = join(import.meta.dirname, '../../eval/attention/corpus.json');
const reviewCorpusPath = join(import.meta.dirname, '../../eval/primary-review/corpus.json');

describe('loadCorpus', () => {
  it('loads attention corpus definition', () => {
    const corpus = loadCorpus(attentionCorpusPath);
    expect(corpus.role).toBe('attention');
    expect(corpus.cases).toHaveLength(5);
  });

  it('loads primary review corpus definition', () => {
    const corpus = loadCorpus(reviewCorpusPath);
    expect(corpus.role).toBe('primaryReview');
    expect(corpus.cases).toHaveLength(5);
  });
});

describe('runAttentionEval', () => {
  it('evaluates all attention cases with passing executor', async () => {
    const result = await runAttentionEval(attentionCorpusPath, async (input: unknown) => {
      const candidates = (input as { candidates: Array<{ repositoryKey: string; prNumber: number }> }).candidates;
      return {
        items: candidates.map(c => ({
          repositoryKey: c.repositoryKey,
          prNumber: c.prNumber,
          relevance: 'critical',
          risk: 'high',
          recommendedAction: 'review',
        })),
      } satisfies AttentionRunOutput;
    });
    expect(result.role).toBe('attention');
    expect(result.caseResults).toHaveLength(5);
    expect(result.aggregateMetrics.mustEscalateRecall).toBeDefined();
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
    const corpus = loadCorpus(attentionCorpusPath);
    const basePath = join(attentionCorpusPath, '..');
    const caseData = loadCase(basePath, corpus.cases[0]!) as { caseId: string };
    expect(caseData.caseId).toBe('attn_must_escalate_security_vuln_01');
  });
});
