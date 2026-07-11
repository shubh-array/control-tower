import type { AllTrackedItem } from '../policy/evaluate.js';

export interface JobDetail {
  id: string;
  state: string;
  repositoryKey: string;
  prNumber: number;
}

export interface DraftDetail {
  jobId: string;
  body: string;
  findings: unknown[];
}

export interface HealthStatus {
  activeJobs: number;
  queuedJobs: number;
  failedJobsLast24h: number;
  uptime: number;
  lastPollTimestamp: string | null;
}

export interface AuditEvent {
  jobId: string;
  event: string;
  timestamp: string;
}

export interface OrchestratorFacade {
  getAllTracked(): AllTrackedItem[];
  getFocusQueue(): { now: AllTrackedItem[]; next: AllTrackedItem[]; monitor: AllTrackedItem[] };
  getJob(id: string): JobDetail | null;
  getDraft(jobId: string): DraftDetail | null;
  getHealthStatus(): HealthStatus;
  getAuditTrail(jobId: string): AuditEvent[];
  requestAnalyze(input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: 'registered-source' | 'remote-evidence-only';
  }): string;
  requestRetry(jobId: string): string;
  requestAdvice(repositoryKey: string, prNumber: number): void;
}

export interface FacadeDeps {
  getAllTracked(): AllTrackedItem[];
  getFocusQueue(): { now: AllTrackedItem[]; next: AllTrackedItem[]; monitor: AllTrackedItem[] };
  getJob(id: string): JobDetail | null;
  getDraft(jobId: string): DraftDetail | null;
  getAuditTrail(jobId: string): AuditEvent[];
  enqueueAnalysis(input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: string;
  }): string;
  enqueueRetry(jobId: string): string;
  scheduleAdvice(repositoryKey: string, prNumber: number): void;
  getHealthStatus(): HealthStatus;
  enqueuedJobs: Array<{ repositoryKey: string; prNumber: number }>;
}

export function createOrchestratorFacade(deps: FacadeDeps): OrchestratorFacade {
  return {
    getAllTracked(): AllTrackedItem[] {
      return deps.getAllTracked();
    },

    getFocusQueue() {
      return deps.getFocusQueue();
    },

    getJob(id: string): JobDetail | null {
      return deps.getJob(id);
    },

    getDraft(jobId: string): DraftDetail | null {
      return deps.getDraft(jobId);
    },

    getHealthStatus(): HealthStatus {
      return deps.getHealthStatus();
    },

    getAuditTrail(jobId: string): AuditEvent[] {
      return deps.getAuditTrail(jobId);
    },

    requestAnalyze(input): string {
      return deps.enqueueAnalysis({
        repositoryKey: input.repositoryKey,
        prNumber: input.prNumber,
        sourceMode: input.sourceMode,
      });
    },

    requestRetry(jobId: string): string {
      return deps.enqueueRetry(jobId);
    },

    requestAdvice(repositoryKey: string, prNumber: number): void {
      deps.scheduleAdvice(repositoryKey, prNumber);
    },
  };
}
