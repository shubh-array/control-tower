export const ATTENTION_STATES = [
  "monitoring",
  "ready_for_analysis",
  "analysis_queued",
  "draft_ready",
  "needs_human",
  "completed",
  "closed",
] as const;

export type AttentionState = (typeof ATTENTION_STATES)[number];

const TERMINAL: ReadonlySet<AttentionState> = new Set(["completed", "closed"]);

export function isTerminalAttention(state: AttentionState): boolean {
  return TERMINAL.has(state);
}
