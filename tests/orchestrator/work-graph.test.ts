// tests/orchestrator/work-graph.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { WorkGraph } from '../../src/orchestrator/work-graph.js';
import { openDatabase } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import {
  upsertRepository,
  upsertPr,
  upsertPrFiles,
  upsertPrChecks,
  upsertReviewRequests,
  upsertAttentionItem,
} from '../../src/normalize/upsert.js';
import type { PolicyDecision } from '../../src/policy/evaluate.js';
import type { DiscoveredPr } from '../../src/github/types.js';

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

function makeDiscoveredPr(overrides: Partial<DiscoveredPr> = {}): DiscoveredPr {
  return {
    repositoryId: 'pba-webapp',
    githubOwnerRepo: 'Org/pba-webapp',
    prNumber: 1,
    title: 'Test PR',
    body: 'PR body content',
    url: 'https://github.com/Org/pba-webapp/pull/1',
    state: 'OPEN',
    isDraft: false,
    authorLogin: 'dev',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    labels: ['bug', 'frontend'],
    additions: 10,
    deletions: 5,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    changedFiles: ['src/index.ts'],
    unsafeFiles: [],
    reviewRequests: [{ login: 'reviewer' }],
    checks: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: '', __typename: 'CheckRun' }],
    reviews: [],
    comments: [],
    explicitRequest: false,
    ...overrides,
  };
}

function seedTrackedItem(
  db: Database.Database,
  prNumber: number,
  policy: PolicyDecision,
  prOverrides: Partial<DiscoveredPr> = {},
): void {
  upsertRepository(db, {
    id: 'pba-webapp',
    github: 'Org/pba-webapp',
    host: 'github.com',
    defaultBranch: 'main',
    resourceClass: 'medium',
  });

  const pr = makeDiscoveredPr({ prNumber, ...prOverrides });
  const prId = upsertPr(db, pr);
  upsertPrFiles(db, prId, pr.changedFiles, pr.unsafeFiles);
  upsertPrChecks(db, prId, pr.checks);
  upsertReviewRequests(db, prId, pr.reviewRequests);
  upsertAttentionItem(db, prId, pr, policy, 'pba-webapp', 'registered-source');
}

describe('WorkGraph (real DB)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getAllTracked', () => {
    it('returns all PRs including ineligible ones', () => {
      seedTrackedItem(db, 1, stubPolicy({ eligible: true }));
      seedTrackedItem(
        db,
        2,
        stubPolicy({
          eligible: false,
          prioritySortOrdinal: 4,
          priorityStatus: 'unranked',
        }),
      );

      const graph = new WorkGraph(db);
      const tracked = graph.getAllTracked();

      expect(tracked).toHaveLength(2);
      expect(tracked.find((t) => t.prNumber === 2)).toBeDefined();
      expect(tracked.find((t) => t.prNumber === 2)!.policy.eligible).toBe(false);
    });

    it('projects real schema columns to AllTrackedItem fields', () => {
      seedTrackedItem(
        db,
        1,
        stubPolicy(),
        {
          headSha: 'c'.repeat(40),
          labels: ['enhancement'],
          body: 'x'.repeat(9000),
          reviewRequests: [],
        },
      );

      const item = new WorkGraph(db).getAllTracked()[0]!;

      expect(item.headSha).toBe('c'.repeat(40));
      expect(item.author).toBe('dev');
      expect(item.labels).toEqual(['enhancement']);
      expect(item.reviewRequested).toBe(false);
      expect(item.changedFiles).toEqual(['src/index.ts']);
      expect(item.checkSummary).toEqual([
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ]);
      expect(item.updatedAt).toBe('2026-07-10T00:00:00.000Z');
      expect(item.sourceMode).toBe('registered-source');
      expect(item.bodyTruncated.length).toBeLessThanOrEqual(8 * 1024);
      expect(Buffer.byteLength(item.bodyTruncated, 'utf-8')).toBeLessThanOrEqual(8 * 1024);
    });
  });

  describe('getFocusQueue', () => {
    it('excludes unranked items (prioritySortOrdinal >= 4)', () => {
      seedTrackedItem(db, 1, stubPolicy({ prioritySortOrdinal: 1, priorityStatus: 'p1' }));
      seedTrackedItem(
        db,
        2,
        stubPolicy({ prioritySortOrdinal: 4, priorityStatus: 'unranked' }),
      );

      const queue = new WorkGraph(db).getFocusQueue();
      const allFocusItems = [...queue.now, ...queue.next, ...queue.monitor];

      expect(allFocusItems.find((i) => i.prNumber === 2)).toBeUndefined();
      expect(allFocusItems.find((i) => i.prNumber === 1)).toBeDefined();
    });

    it('places p0/p1 in now, p2 in next, p3 in monitor', () => {
      seedTrackedItem(db, 10, stubPolicy({ prioritySortOrdinal: 0, priorityStatus: 'p0' }));
      seedTrackedItem(db, 20, stubPolicy({ prioritySortOrdinal: 2, priorityStatus: 'p2' }));
      seedTrackedItem(db, 30, stubPolicy({ prioritySortOrdinal: 3, priorityStatus: 'p3' }));

      const queue = new WorkGraph(db).getFocusQueue();

      expect(queue.now.map((i) => i.prNumber)).toContain(10);
      expect(queue.next.map((i) => i.prNumber)).toContain(20);
      expect(queue.monitor.map((i) => i.prNumber)).toContain(30);
    });

    it('returns empty buckets when no eligible items exist', () => {
      const queue = new WorkGraph(db).getFocusQueue();

      expect(queue.now).toEqual([]);
      expect(queue.next).toEqual([]);
      expect(queue.monitor).toEqual([]);
    });
  });
});
