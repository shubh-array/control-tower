// tests/orchestrator/facade.test.ts
import { describe, it, expect } from 'vitest';
import {
  createOrchestratorFacade,
  type FacadeDeps,
} from '../../src/orchestrator/facade.js';
import { PrNotEligibleForReviewError } from '../../src/orchestrator/analyze-errors.js';
import type { ReviewQueueItem, PolicyDecision } from '../../src/policy/evaluate.js';
import type { DraftDetail, JobDetail } from '../../src/api/contracts.js';

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: 'p1',
    prioritySortOrdinal: 1,
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

function makeQueueItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 1,
    headSha: 'a'.repeat(40),
    title: 'Test PR',
    url: 'https://github.com/pba-webapp/pull/1',
    author: 'dev',
    updatedAt: '2026-07-10T00:00:00.000Z',
    explicitRequest: true,
    explicitRequestTimestamp: null,
    policy: stubPolicy(),
    ...overrides,
  };
}

interface MockJob extends JobDetail {}

interface MockDraft extends DraftDetail {}

interface MockAuditEvent {
  jobId: string;
  event: string;
  timestamp: string;
}

function makeFacadeDeps(options: {
  queueItems?: ReviewQueueItem[];
  jobs?: Map<string, MockJob>;
  drafts?: Map<string, MockDraft>;
  auditTrail?: Map<string, MockAuditEvent[]>;
  enqueueAnalysis?: FacadeDeps['enqueueAnalysis'];
} = {}): FacadeDeps {
  const queueItems = options.queueItems ?? [makeQueueItem()];
  const jobs = options.jobs ?? new Map();
  const drafts = options.drafts ?? new Map();
  const auditTrail = options.auditTrail ?? new Map();
  const enqueuedJobs: Array<{ repositoryKey: string; prNumber: number }> = [];

  return {
    getFocusQueue: () => ({
      now: queueItems.filter(i => i.policy.prioritySortOrdinal <= 1),
      next: queueItems.filter(i => i.policy.prioritySortOrdinal === 2),
      monitor: queueItems.filter(i => i.policy.prioritySortOrdinal === 3),
    }),
    getJob: (id: string) => jobs.get(id) ?? null,
    getDraft: (jobId: string) => drafts.get(jobId) ?? null,
    getAuditTrail: (jobId: string) => auditTrail.get(jobId) ?? [],
    enqueueAnalysis: options.enqueueAnalysis ?? ((input) => {
      const id = `job-${enqueuedJobs.length + 1}`;
      enqueuedJobs.push({ repositoryKey: input.repositoryKey, prNumber: input.prNumber });
      return id;
    }),
    enqueueRetry: (jobId: string) => jobId,
    getHealthStatus: () => ({
      activeJobs: jobs.size,
      queuedJobs: 0,
      failedJobsLast24h: 0,
      uptime: 3600,
      lastPollTimestamp: '2026-07-10T00:00:00.000Z',
    }),
    enqueuedJobs,
  };
}

describe('OrchestratorFacade', () => {
  it('does not expose getAllTracked', () => {
    const facade = createOrchestratorFacade(makeFacadeDeps());
    expect(facade).not.toHaveProperty('getAllTracked');
  });

  describe('getFocusQueue', () => {
    it('returns bucketed focus queue', () => {
      const items = [
        makeQueueItem({ prNumber: 1, policy: stubPolicy({ prioritySortOrdinal: 0 }) }),
        makeQueueItem({ prNumber: 2, policy: stubPolicy({ prioritySortOrdinal: 2 }) }),
      ];
      const facade = createOrchestratorFacade(makeFacadeDeps({ queueItems: items }));
      const queue = facade.getFocusQueue();

      expect(queue.now).toHaveLength(1);
      expect(queue.next).toHaveLength(1);
    });
  });

  describe('requestAnalyze', () => {
    it('enqueues an analysis job and returns job id', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const jobId = facade.requestAnalyze({
        repositoryKey: 'pba-webapp',
        prNumber: 42,
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(deps.enqueuedJobs).toHaveLength(1);
      expect(deps.enqueuedJobs[0]!.prNumber).toBe(42);
    });

    it('propagates ineligible errors from enqueue', () => {
      const facade = createOrchestratorFacade(
        makeFacadeDeps({
          enqueueAnalysis: () => {
            throw new PrNotEligibleForReviewError();
          },
        }),
      );

      expect(() =>
        facade.requestAnalyze({ repositoryKey: 'repo-a', prNumber: 7 }),
      ).toThrow('PR is not eligible for review');
    });
  });

  describe('requestRetry', () => {
    it('requeues the failed job and returns its job id', () => {
      const facade = createOrchestratorFacade(makeFacadeDeps());
      expect(facade.requestRetry('job-1')).toBe('job-1');
    });
  });

  describe('getHealthStatus', () => {
    it('returns runtime health snapshot', () => {
      const facade = createOrchestratorFacade(makeFacadeDeps());
      const health = facade.getHealthStatus();

      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.lastPollTimestamp).toBeDefined();
    });
  });

  describe('getAuditTrail', () => {
    it('returns empty array when no events', () => {
      const facade = createOrchestratorFacade(makeFacadeDeps());
      expect(facade.getAuditTrail('unknown-job')).toEqual([]);
    });
  });
});
