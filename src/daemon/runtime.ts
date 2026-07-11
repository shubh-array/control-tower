import type { OrchestratorFacade } from '../orchestrator/facade.js';

export interface RuntimeConfig {
  port: number;
  schedulerIntervalMs: number;
  attentionIntervalMs: number;
  dataDirectory: string;
}

export interface RuntimeHandle {
  port: number;
  facade: OrchestratorFacade;
  stop: () => Promise<void>;
}

export interface RuntimeDeps {
  migrate(): void;
  recoverOrphanedStates(): {
    failedJobs: string[];
    failedRuns: string[];
    failedAdvisorRuns: string[];
    autoRetried: string[];
    failureReasons: Map<string, string>;
    publishingReconciled: string[];
  };
  startDiscoveryPoller(): { stop: () => void };
  runSchedulerTick(): { jobsToStart: string[]; reason: string };
  runAttentionBatch(): void;
  createFacade(): OrchestratorFacade;
}

export async function startRuntime(
  config: RuntimeConfig,
  deps: RuntimeDeps,
): Promise<RuntimeHandle> {
  deps.migrate();
  deps.recoverOrphanedStates();

  const poller = deps.startDiscoveryPoller();

  let schedulerTimer: ReturnType<typeof setInterval> | null = null;
  let attentionTimer: ReturnType<typeof setInterval> | null = null;

  schedulerTimer = setInterval(() => {
    try {
      deps.runSchedulerTick();
    } catch {
      // scheduler tick errors are logged, not fatal
    }
  }, config.schedulerIntervalMs);

  attentionTimer = setInterval(() => {
    try {
      deps.runAttentionBatch();
    } catch {
      // attention batch errors are logged, not fatal
    }
  }, config.attentionIntervalMs);

  const facade = deps.createFacade();

  async function stop(): Promise<void> {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (attentionTimer) {
      clearInterval(attentionTimer);
      attentionTimer = null;
    }
    poller.stop();
  }

  return {
    port: config.port,
    facade,
    stop,
  };
}

export async function stopRuntime(handle: RuntimeHandle): Promise<void> {
  await handle.stop();
}
