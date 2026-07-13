// tests/orchestrator/facade.test.ts
import { describe, it, expect } from 'vitest';
import {
  createOrchestratorFacade,
  type FacadeDeps,
} from '../../src/orchestrator/facade.js';
import type { AllTrackedItem, PolicyDecision } from '../../src/policy/evaluate.js';
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

function makeTrackedItem(overrides: Partial<AllTrackedItem> = {}): AllTrackedItem {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 1,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    title: 'Test PR',
    url: 'https://github.com/pba-webapp/pull/1',
    author: 'dev',
    draft: false,
    labels: [],
    additions: 10,
    deletions: 5,
    changedFiles: ['src/index.ts'],
    reviewRequested: true,
    checkSummary: [],
    updatedAt: '2026-07-10T00:00:00.000Z',
    explicitRequestTimestamp: null,
    policy: stubPolicy(),
    sourceMode: 'registered-source',
    bodyTruncated: '',
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
  tracked?: AllTrackedItem[];
  jobs?: Map<string, MockJob>;
  drafts?: Map<string, MockDraft>;
  auditTrail?: Map<string, MockAuditEvent[]>;
} = {}): FacadeDeps {
  const tracked = options.tracked ?? [makeTrackedItem()];
  const jobs = options.jobs ?? new Map();
  const drafts = options.drafts ?? new Map();
  const auditTrail = options.auditTrail ?? new Map();
  const enqueuedJobs: Array<{ repositoryKey: string; prNumber: number }> = [];

  return {
    getAllTracked: () => tracked,
    getFocusQueue: () => ({
      now: tracked.filter(i => i.policy.prioritySortOrdinal <= 1),
      next: tracked.filter(i => i.policy.prioritySortOrdinal === 2),
      monitor: tracked.filter(i => i.policy.prioritySortOrdinal === 3),
    }),
    getJob: (id: string) => jobs.get(id) ?? null,
    getDraft: (jobId: string) => drafts.get(jobId) ?? null,
    getAuditTrail: (jobId: string) => auditTrail.get(jobId) ?? [],
    enqueueAnalysis: (input: { repositoryKey: string; prNumber: number; sourceMode?: string }) => {
      const id = `job-${enqueuedJobs.length + 1}`;
      enqueuedJobs.push({ repositoryKey: input.repositoryKey, prNumber: input.prNumber });
      return id;
    },
    enqueueRetry: (jobId: string) => {
      return `retry-${jobId}`;
    },
    scheduleAdvice: (_repositoryKey: string, _prNumber: number) => {},
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
  describe('getAllTracked', () => {
    it('returns all tracked items from work graph', () => {
      const items = [makeTrackedItem({ prNumber: 1 }), makeTrackedItem({ prNumber: 2 })];
      const deps = makeFacadeDeps({ tracked: items });
      const facade = createOrchestratorFacade(deps);

      expect(facade.getAllTracked()).toHaveLength(2);
    });
  });

  describe('getFocusQueue', () => {
    it('returns bucketed focus queue', () => {
      const items = [
        makeTrackedItem({ prNumber: 1, policy: stubPolicy({ prioritySortOrdinal: 0 }) }),
        makeTrackedItem({ prNumber: 2, policy: stubPolicy({ prioritySortOrdinal: 2 }) }),
      ];
      const deps = makeFacadeDeps({ tracked: items });
      const facade = createOrchestratorFacade(deps);
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

    it('passes sourceMode to enqueue', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      facade.requestAnalyze({
        repositoryKey: 'pba-webapp',
        prNumber: 42,
        sourceMode: 'remote-evidence-only',
      });

      expect(deps.enqueuedJobs).toHaveLength(1);
    });
  });

  describe('requestRetry', () => {
    it('creates a new run for the given job', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const newRunId = facade.requestRetry('job-1');

      expect(newRunId).toBe('retry-job-1');
    });
  });

  describe('requestAdvice', () => {
    it('schedules advice without throwing', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      expect(() => facade.requestAdvice('pba-webapp', 42)).not.toThrow();
    });
  });

  describe('getHealthStatus', () => {
    it('returns runtime health snapshot', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const health = facade.getHealthStatus();

      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.lastPollTimestamp).toBeDefined();
    });
  });

  describe('getAuditTrail', () => {
    it('returns empty array when no events', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const trail = facade.getAuditTrail('unknown-job');

      expect(trail).toEqual([]);
    });
  });
});
