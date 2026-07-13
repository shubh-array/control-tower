import type { TrackedQueueRow } from "./api.js";

export const QUEUE_ACTIVE_POLL_MS = 3_000;
export const QUEUE_IDLE_POLL_MS = 30_000;
export const HEALTH_POLL_MS = 30_000;

const ACTIVE_JOB_STATES = new Set([
  "queued",
  "preparing_context",
  "preparing_source",
  "running_agent",
  "validating_output",
  "publishing",
]);

export function queueHasActiveJob(rows: TrackedQueueRow[]): boolean {
  return rows.some(
    (row) => row.jobState !== null && ACTIVE_JOB_STATES.has(row.jobState),
  );
}

export function resolveQueueRefetchInterval(input: {
  isVisible: boolean;
  hasActiveJob: boolean;
}): number | false {
  if (!input.isVisible) {
    return false;
  }
  return input.hasActiveJob ? QUEUE_ACTIVE_POLL_MS : QUEUE_IDLE_POLL_MS;
}
