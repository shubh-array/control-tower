import { describe, it, expect } from 'vitest';
import {
  selectCandidates,
  type CandidateInput,
  type CandidateSelectionConfig,
} from '../../src/attention/candidates.js';

function makeItem(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 1,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    title: 'Test PR',
    author: 'test-user',
    draft: false,
    labels: [],
    additions: 10,
    deletions: 5,
    changedFiles: ['src/index.ts'],
    reviewRequested: true,
    checkSummary: [],
    updatedAt: '2026-07-10T00:00:00Z',
    bodyTruncated: '',
    prioritySortOrdinal: 3,
    explicitRequestSort: 1,
    queueTimestamp: '2026-07-10T00:00:00Z',
    normalizedRepositoryIdentity: 'github:github.com/org/pba-webapp',
    eligible: true,
    hasCurrentAdvice: false,
    adviceStale: false,
    previouslyFailed: false,
    previouslyNotScheduled: false,
    ...overrides,
  };
}

const DEFAULT_CONFIG: CandidateSelectionConfig = {
  maxCandidatesPerInvocation: 5,
};

describe('selectCandidates', () => {
  it('selects never-advised items first', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true }),
      makeItem({ prNumber: 2, hasCurrentAdvice: false }),
      makeItem({ prNumber: 3, hasCurrentAdvice: false }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected.map(c => c.prNumber)).toEqual([2, 3]);
  });

  it('selects stale/changed items', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, adviceStale: true }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, adviceStale: false }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected.map(c => c.prNumber)).toEqual([1]);
  });

  it('selects previously not_scheduled items', () => {
    const items = [
      makeItem({ prNumber: 1, previouslyNotScheduled: true }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected.map(c => c.prNumber)).toEqual([1]);
  });

  it('excludes failed exact identities from automatic selection', () => {
    const items = [
      makeItem({ prNumber: 1, previouslyFailed: true }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected).toHaveLength(0);
  });

  it('respects maxCandidatesPerInvocation bound', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ prNumber: i + 1, hasCurrentAdvice: false }),
    );
    const selected = selectCandidates(items, { maxCandidatesPerInvocation: 3 });
    expect(selected).toHaveLength(3);
  });

  it('eligible tiers precede unranked in selection order', () => {
    const items = [
      makeItem({ prNumber: 1, prioritySortOrdinal: 4, eligible: false, hasCurrentAdvice: false }),
      makeItem({ prNumber: 2, prioritySortOrdinal: 3, eligible: true, hasCurrentAdvice: false }),
      makeItem({ prNumber: 3, prioritySortOrdinal: 0, eligible: true, hasCurrentAdvice: false }),
    ];
    const selected = selectCandidates(items, { maxCandidatesPerInvocation: 2 });
    expect(selected.map(c => c.prNumber)).toEqual([3, 2]);
  });

  it('CRITICAL: advice cannot enqueue analysis — selection is metadata triage only', () => {
    const items = [makeItem({ prNumber: 1 })];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    for (const candidate of selected) {
      expect(candidate).not.toHaveProperty('enqueueAnalysis');
      expect(candidate).not.toHaveProperty('authorizeAnalysis');
    }
  });
});
