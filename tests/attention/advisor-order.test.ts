import { describe, it, expect } from 'vitest';
import { computeAdvisorOrder, type AdvisorOrderItem } from '../../src/attention/advisor-order.js';

function makeItem(overrides: Partial<AdvisorOrderItem> = {}): AdvisorOrderItem {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 1,
    hasCurrentAdvice: false,
    relevance: null,
    risk: null,
    prioritySortOrdinal: 3,
    explicitRequestSort: 1,
    queueTimestamp: '2026-07-10T00:00:00Z',
    normalizedRepositoryIdentity: 'github:github.com/org/pba-webapp',
    ...overrides,
  };
}

describe('computeAdvisorOrder', () => {
  it('items with current advice sort before items without', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: false }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'medium', risk: 'low' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted[0]!.prNumber).toBe(2);
    expect(sorted[1]!.prNumber).toBe(1);
  });

  it('sorts advised items by relevance ordinal then risk ordinal', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, relevance: 'low', risk: 'high' }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'critical', risk: 'medium' }),
      makeItem({ prNumber: 3, hasCurrentAdvice: true, relevance: 'high', risk: 'low' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted.map(i => i.prNumber)).toEqual([2, 3, 1]);
  });

  it('breaks relevance ties by risk ordinal', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, relevance: 'high', risk: 'low' }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'high', risk: 'critical' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted.map(i => i.prNumber)).toEqual([2, 1]);
  });

  it('falls back to deterministic queue tuple after risk tie', () => {
    const items = [
      makeItem({ prNumber: 5, hasCurrentAdvice: true, relevance: 'medium', risk: 'medium',
        prioritySortOrdinal: 2, normalizedRepositoryIdentity: 'github:github.com/org/z-repo' }),
      makeItem({ prNumber: 3, hasCurrentAdvice: true, relevance: 'medium', risk: 'medium',
        prioritySortOrdinal: 2, normalizedRepositoryIdentity: 'github:github.com/org/a-repo' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted[0]!.prNumber).toBe(3); // a-repo before z-repo
  });

  it('non-advised items preserve deterministic relative order among themselves', () => {
    const items = [
      makeItem({ prNumber: 10, hasCurrentAdvice: false, prioritySortOrdinal: 1 }),
      makeItem({ prNumber: 5, hasCurrentAdvice: false, prioritySortOrdinal: 0 }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted.map(i => i.prNumber)).toEqual([5, 10]);
  });

  it('CRITICAL: produces identical order regardless of batch partition history', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, relevance: 'high', risk: 'low' }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'critical', risk: 'medium' }),
      makeItem({ prNumber: 3, hasCurrentAdvice: false, prioritySortOrdinal: 0 }),
    ];
    const order1 = computeAdvisorOrder(items).map(i => i.prNumber);
    const order2 = computeAdvisorOrder([...items].reverse()).map(i => i.prNumber);
    expect(order1).toEqual(order2);
  });
});
