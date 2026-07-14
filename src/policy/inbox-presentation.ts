/** Pipeline buckets for inbox summary — mirrors `client/src/lib/queue-display.ts`. */

export const ACTIVE_JOB_STATES = new Set([
  "queued",
  "preparing_context",
  "preparing_source",
  "running_agent",
  "validating_output",
]);

export const REVIEWABLE_JOB_STATES = new Set([
  "draft_ready",
  "awaiting_approval",
  "publishing",
]);

export type InboxPipelineBucket =
  | "ready"
  | "analyzing"
  | "failed"
  | "needs_analysis";

export function classifyInboxPipeline(
  jobState: string | null,
): InboxPipelineBucket {
  if (jobState === "failed") {
    return "failed";
  }
  if (jobState !== null && REVIEWABLE_JOB_STATES.has(jobState)) {
    return "ready";
  }
  if (jobState !== null && ACTIVE_JOB_STATES.has(jobState)) {
    return "analyzing";
  }
  return "needs_analysis";
}

export function isDraftStale(input: {
  prHeadSha: string;
  jobHeadSha: string | null;
  jobState: string | null;
}): boolean {
  if (input.jobHeadSha === null || input.jobState === null) {
    return false;
  }
  if (!REVIEWABLE_JOB_STATES.has(input.jobState)) {
    return false;
  }
  return input.prHeadSha !== input.jobHeadSha;
}
