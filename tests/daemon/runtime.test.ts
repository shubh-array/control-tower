// tests/daemon/runtime.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  startRuntime,
  stopRuntime,
  type RuntimeConfig,
  type RuntimeDeps,
  type RuntimeHandle,
} from '../../src/daemon/runtime.js';

function makeFakeRuntimeDeps(): RuntimeDeps & {
  migrateCalled: boolean;
  recoveryCalled: boolean;
  pollerStarted: boolean;
  schedulerTicks: number;
  attentionBatches: number;
} {
  return {
    migrateCalled: false,
    recoveryCalled: false,
    pollerStarted: false,
    schedulerTicks: 0,
    attentionBatches: 0,

    migrate() {
      this.migrateCalled = true;
    },
    recoverOrphanedStates() {
      this.recoveryCalled = true;
      return { failedJobs: [], failedRuns: [], failedAdvisorRuns: [], autoRetried: [], failureReasons: new Map(), publishingReconciled: [] };
    },
    startDiscoveryPoller() {
      this.pollerStarted = true;
      return { stop: () => { this.pollerStarted = false; } };
    },
    runSchedulerTick() {
      this.schedulerTicks++;
      return { jobsToStart: [], reason: 'no_eligible_candidates' };
    },
    runAttentionBatch() {
      this.attentionBatches++;
    },
    createFacade() {
      return {
        getAllTracked: () => [],
        getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
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
        requestAdvice: () => {},
      };
    },
  };
}

const DEFAULT_CONFIG: RuntimeConfig = {
  port: 9120,
  schedulerIntervalMs: 5000,
  attentionIntervalMs: 60000,
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
});
