export const RUN_STATES = [
  "allocated",
  "running",
  "validating",
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
] as const;

export type RunState = (typeof RUN_STATES)[number];

const TERMINAL: ReadonlySet<RunState> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
]);

export function isTerminalRun(state: RunState): boolean {
  return TERMINAL.has(state);
}

export const ALLOWED_RUN_TRANSITIONS: ReadonlyMap<
  RunState,
  ReadonlySet<RunState>
> = new Map<RunState, ReadonlySet<RunState>>([
  [
    "allocated",
    new Set(["running", "failed", "cancelled", "superseded"]),
  ],
  [
    "running",
    new Set(["validating", "failed", "cancelled", "superseded"]),
  ],
  [
    "validating",
    new Set(["succeeded", "failed", "cancelled", "superseded"]),
  ],
]);

export const ADVISOR_RUN_STATES = [
  "queued",
  "running",
  "validating",
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
] as const;

export type AdvisorRunState = (typeof ADVISOR_RUN_STATES)[number];

export const ALLOWED_ADVISOR_TRANSITIONS: ReadonlyMap<
  AdvisorRunState,
  ReadonlySet<AdvisorRunState>
> = new Map<AdvisorRunState, ReadonlySet<AdvisorRunState>>([
  [
    "queued",
    new Set(["running", "failed", "cancelled", "superseded"]),
  ],
  [
    "running",
    new Set(["validating", "failed", "cancelled", "superseded"]),
  ],
  [
    "validating",
    new Set(["succeeded", "failed", "cancelled", "superseded"]),
  ],
]);
