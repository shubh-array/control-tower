import type { ReviewQueueItem } from '../policy/evaluate.js';
import type { DraftDetail, JobDetail } from '../api/contracts.js';

export type { JobDetail, DraftDetail };

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
  getFocusQueue(): { now: ReviewQueueItem[]; next: ReviewQueueItem[]; monitor: ReviewQueueItem[] };
  getJob(id: string): JobDetail | null;
  getDraft(jobId: string): DraftDetail | null;
  getHealthStatus(): HealthStatus;
  getAuditTrail(jobId: string): AuditEvent[];
  requestAnalyze(input: {
    repositoryKey: string;
    prNumber: number;
  }): string;
  requestRetry(jobId: string): string;
}

export interface FacadeDeps {
  getFocusQueue(): { now: ReviewQueueItem[]; next: ReviewQueueItem[]; monitor: ReviewQueueItem[] };
  getJob(id: string): JobDetail | null;
  getDraft(jobId: string): DraftDetail | null;
  getAuditTrail(jobId: string): AuditEvent[];
  enqueueAnalysis(input: {
    repositoryKey: string;
    prNumber: number;
  }): string;
  enqueueRetry(jobId: string): string;
  getHealthStatus(): HealthStatus;
  enqueuedJobs: Array<{ repositoryKey: string; prNumber: number }>;
}

export function createOrchestratorFacade(deps: FacadeDeps): OrchestratorFacade {
  return {
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
      });
    },

    requestRetry(jobId: string): string {
      return deps.enqueueRetry(jobId);
    },
  };
}
