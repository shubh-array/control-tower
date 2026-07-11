// tests/orchestrator/work-graph.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkGraph, type AllTrackedItem } from '../../src/orchestrator/work-graph.js';
import type { Database } from '../../src/store/db.js';
import type { PolicyDecision } from '../../src/policy/evaluate.js';

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: 'p2',
    prioritySortOrdinal: 2,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: 'auto',
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function makePrRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository_key: 'pba-webapp',
    pr_number: 1,
    head_sha: 'a'.repeat(40),
    base_sha: 'b'.repeat(40),
    title: 'Test PR',
    author: 'dev',
    draft: 0,
    labels_json: '[]',
    additions: 10,
    deletions: 5,
    changed_files_json: '["src/index.ts"]',
    review_requested: 1,
    check_summary_json: '[]',
    updated_at: '2026-07-10T00:00:00.000Z',
    explicit_request_timestamp: null,
    body_truncated: '',
    source_mode: 'registered-source',
    ...overrides,
  };
}

function makeAttentionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository_key: 'pba-webapp',
    pr_number: 1,
    policy_hash: 'hash-1',
    policy_json: JSON.stringify(stubPolicy()),
    state: 'monitoring',
    ...overrides,
  };
}

function createMockDb(prRows: Record<string, unknown>[], attentionRows: Record<string, unknown>[]): Database {
  return {
    run() { return { changes: 0, lastInsertRowid: 0 }; },
    get() { return undefined; },
    all<T>(sql: string): T[] {
      if (sql.includes('FROM prs')) return prRows as T[];
      if (sql.includes('FROM attention_items')) return attentionRows as T[];
      return [];
    },
    transaction<T>(fn: () => T): T { return fn(); },
  };
}

describe('WorkGraph', () => {
  describe('getAllTracked', () => {
    it('returns all PRs including ineligible ones', () => {
      const eligible = makePrRow({ pr_number: 1 });
      const ineligible = makePrRow({ pr_number: 2 });
      const attRows = [
        makeAttentionRow({ pr_number: 1, policy_json: JSON.stringify(stubPolicy({ eligible: true })) }),
        makeAttentionRow({ pr_number: 2, policy_json: JSON.stringify(stubPolicy({ eligible: false, prioritySortOrdinal: 4, priorityStatus: 'unranked' })) }),
      ];
      const db = createMockDb([eligible, ineligible], attRows);
      const graph = new WorkGraph(db);
      const tracked = graph.getAllTracked();

      expect(tracked).toHaveLength(2);
      expect(tracked.find(t => t.prNumber === 2)).toBeDefined();
      expect(tracked.find(t => t.prNumber === 2)!.policy.eligible).toBe(false);
    });

    it('maps snake_case SQL columns to camelCase TypeScript fields', () => {
      const row = makePrRow({ head_sha: 'c'.repeat(40), review_requested: 0 });
      const attRow = makeAttentionRow({ policy_json: JSON.stringify(stubPolicy()) });
      const db = createMockDb([row], [attRow]);
      const graph = new WorkGraph(db);
      const [item] = graph.getAllTracked();

      expect(item.headSha).toBe('c'.repeat(40));
      expect(item.reviewRequested).toBe(false);
      expect(item.changedFiles).toEqual(['src/index.ts']);
    });
  });

  describe('getFocusQueue', () => {
    it('excludes unranked items (prioritySortOrdinal >= 4)', () => {
      const p1 = makePrRow({ pr_number: 1 });
      const unranked = makePrRow({ pr_number: 2 });
      const attRows = [
        makeAttentionRow({ pr_number: 1, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 1, priorityStatus: 'p1' })) }),
        makeAttentionRow({ pr_number: 2, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 4, priorityStatus: 'unranked' })) }),
      ];
      const db = createMockDb([p1, unranked], attRows);
      const graph = new WorkGraph(db);
      const queue = graph.getFocusQueue();

      const allFocusItems = [...queue.now, ...queue.next, ...queue.monitor];
      expect(allFocusItems.find(i => i.prNumber === 2)).toBeUndefined();
      expect(allFocusItems.find(i => i.prNumber === 1)).toBeDefined();
    });

    it('places p0/p1 in now, p2 in next, p3 in monitor', () => {
      const rows = [
        makePrRow({ pr_number: 10 }),
        makePrRow({ pr_number: 20 }),
        makePrRow({ pr_number: 30 }),
      ];
      const attRows = [
        makeAttentionRow({ pr_number: 10, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 0, priorityStatus: 'p0' })) }),
        makeAttentionRow({ pr_number: 20, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 2, priorityStatus: 'p2' })) }),
        makeAttentionRow({ pr_number: 30, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 3, priorityStatus: 'p3' })) }),
      ];
      const db = createMockDb(rows, attRows);
      const graph = new WorkGraph(db);
      const queue = graph.getFocusQueue();

      expect(queue.now.map(i => i.prNumber)).toContain(10);
      expect(queue.next.map(i => i.prNumber)).toContain(20);
      expect(queue.monitor.map(i => i.prNumber)).toContain(30);
    });

    it('returns empty buckets when no eligible items exist', () => {
      const db = createMockDb([], []);
      const graph = new WorkGraph(db);
      const queue = graph.getFocusQueue();

      expect(queue.now).toEqual([]);
      expect(queue.next).toEqual([]);
      expect(queue.monitor).toEqual([]);
    });
  });
});
