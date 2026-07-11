export const JOB_STATES = [
  "queued",
  "preparing_context",
  "preparing_source",
  "running_agent",
  "validating_output",
  "draft_ready",
  "awaiting_approval",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "superseded",
] as const;

export type JobState = (typeof JOB_STATES)[number];

const TERMINAL: ReadonlySet<JobState> = new Set([
  "published",
  "cancelled",
  "superseded",
]);

const PRE_PUBLICATION_NONTERMINAL: ReadonlySet<JobState> = new Set([
  "queued",
  "preparing_context",
  "preparing_source",
  "running_agent",
  "validating_output",
  "draft_ready",
]);

export function isTerminalJob(state: JobState): boolean {
  return TERMINAL.has(state);
}

export function isPrePublicationNonterminal(state: JobState): boolean {
  return PRE_PUBLICATION_NONTERMINAL.has(state);
}

export const ALLOWED_JOB_TRANSITIONS: ReadonlyMap<
  JobState,
  ReadonlySet<JobState>
> = new Map<JobState, ReadonlySet<JobState>>([
  [
    "queued",
    new Set(["preparing_context", "failed", "cancelled", "superseded"]),
  ],
  [
    "preparing_context",
    new Set([
      "preparing_source",
      "running_agent",
      "failed",
      "cancelled",
      "superseded",
    ]),
  ],
  [
    "preparing_source",
    new Set(["running_agent", "failed", "cancelled", "superseded"]),
  ],
  [
    "running_agent",
    new Set(["validating_output", "failed", "cancelled", "superseded"]),
  ],
  [
    "validating_output",
    new Set(["draft_ready", "failed", "cancelled", "superseded"]),
  ],
  [
    "draft_ready",
    new Set(["awaiting_approval", "failed", "cancelled", "superseded"]),
  ],
  [
    "awaiting_approval",
    new Set(["publishing", "failed", "cancelled", "superseded"]),
  ],
  [
    "publishing",
    new Set(["published", "failed", "cancelled", "superseded"]),
  ],
  ["failed", new Set(["queued", "superseded"])],
]);
