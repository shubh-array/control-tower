// tests/daemon/runtime.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  startRuntime,
  stopRuntime,
  type RuntimeConfig,
  type RuntimeDeps,
  type RuntimeHandle,
} from '../../src/daemon/runtime.js';
import type { AllTrackedItem } from '../../src/policy/evaluate.js';

function makeTrackedItemFixture(): AllTrackedItem {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 42,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    title: 'Fix bug',
    url: 'https://github.com/pba-webapp/pull/42',
    author: 'dev',
    draft: false,
    labels: [],
    additions: 1,
    deletions: 0,
    changedFiles: ['src/a.ts'],
    reviewRequested: true,
    checkSummary: [],
    updatedAt: '2026-07-10T12:00:00.000Z',
    explicitRequestTimestamp: null,
    policy: {
      eligible: true,
      eligibilityReasons: [
        { code: 'explicit_review_request', requestedLogin: 'dev' },
      ],
      exclusionReasons: [],
      authorOnly: false,
      priorityStatus: 'p1',
      prioritySortOrdinal: 1,
      priorityReasons: [
        {
          code: 'priority_rule',
          tier: 'p1',
          declarationIndex: 0,
          matchedPath: 'src/a.ts',
          matchedRule: 'backend',
        },
      ],
      allPriorityReasons: [],
      selectedPriorityReason: null,
      analysisMode: 'on_demand',
      autoAnalyzeReasons: [],
      selectedDomains: [
        {
          domain: 'backend',
          selectedPriority: 1,
          selectedDeclarationIndex: 0,
          matchedPaths: ['src/a.ts'],
          allReasons: [],
        },
      ],
      allDomainReasons: [],
    },
    sourceMode: 'registered-source',
    bodyTruncated: '',
  };
}

function makeFakeRuntimeDeps(options?: {
  tracked?: AllTrackedItem[];
}): RuntimeDeps & {
  migrateCalled: boolean;
  recoveryCalled: boolean;
  pollerStarted: boolean;
  schedulerTicks: number;
} {
  const tracked = options?.tracked ?? [];
  return {
    migrateCalled: false,
    recoveryCalled: false,
    pollerStarted: false,
    schedulerTicks: 0,

    migrate() {
      this.migrateCalled = true;
    },
    recoverOrphanedStates() {
      this.recoveryCalled = true;
      return { failedJobs: [], failedRuns: [], autoRetried: [], failureReasons: new Map(), publishingReconciled: [] };
    },
    startDiscoveryPoller() {
      this.pollerStarted = true;
      return { stop: () => { this.pollerStarted = false; } };
    },
    runSchedulerTick() {
      this.schedulerTicks++;
      return { jobsToStart: [], reason: 'no_eligible_candidates' };
    },
    createFacade() {
      return {
        getAllTracked: () => tracked,
        getFocusQueue: () => ({ now: tracked, next: [], monitor: [] }),
        getJob: () => null,
        getDraft: () => null,
        getHealthStatus: () => ({
          activeJobs: 0,
          queuedJobs: 0,
          failedJobsLast24h: 0,
          uptime: 0,
          lastPollTimestamp: null,
        }),
        getAuditTrail: () => [],
        requestAnalyze: () => 'job-1',
        requestRetry: () => 'run-1',
      };
    },
  };
}

const DEFAULT_CONFIG: RuntimeConfig = {
  port: 9120,
  schedulerIntervalMs: 5000,
  dataDirectory: '/tmp/test-data',
  apiServerEnabled: false,
};

describe('startRuntime', () => {
  let handle: RuntimeHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await stopRuntime(handle);
      handle = null;
    }
  });

  it('starts without throwing with fake deps', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(handle).toBeDefined();
    expect(handle.port).toBe(9120);
  });

  it('runs migration on startup', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(deps.migrateCalled).toBe(true);
  });

  it('calls recoverOrphanedStates on startup', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(deps.recoveryCalled).toBe(true);
  });

  it('starts discovery poller', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(deps.pollerStarted).toBe(true);
  });

  it('exposes facade', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(handle.facade).toBeDefined();
    expect(handle.facade.getAllTracked()).toEqual([]);
  });

  it('stopRuntime cleans up poller', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    await stopRuntime(handle);
    expect(deps.pollerStarted).toBe(false);
    handle = null;
  });

  it('maps facade tracked items to /api/queue with repositoryKey and queueOrder', async () => {
    const trackedItem = makeTrackedItemFixture();
    const deps = makeFakeRuntimeDeps({ tracked: [trackedItem] });
    handle = await startRuntime(
      { ...DEFAULT_CONFIG, port: 19120, apiServerEnabled: true },
      deps,
    );

    const sessionRes = await fetch(`${handle.url}/`, { redirect: 'manual' });
    const setCookie = sessionRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(';')[0]!;

    const queueRes = await fetch(`${handle.url}/api/queue`, {
      headers: { cookie },
    });
    expect(queueRes.status).toBe(200);
    const body = await queueRes.json() as {
      allTracked: Array<{ repositoryKey: string; queueOrder: unknown }>;
    };
    expect(body.allTracked).toHaveLength(1);
    expect(body.allTracked[0]!.repositoryKey).toBe('pba-webapp');
    expect(body.allTracked[0]!.queueOrder).toEqual({
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: '2026-07-10T12:00:00.000Z',
      normalizedRepositoryIdentity: 'pba-webapp',
      prNumber: 42,
    });
  });
});
