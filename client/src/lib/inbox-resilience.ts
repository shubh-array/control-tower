import type { FocusQueueRow } from "./api.js";

export const INBOX_REFRESH_ERROR =
  "Could not refresh the inbox. Your action succeeded — retry refresh when the connection recovers.";

export function inboxRowKey(item: FocusQueueRow): string {
  return `${item.repository}-${item.prNumber}`;
}

export function mergeRowPatch(
  item: FocusQueueRow,
  patches: Record<string, Partial<FocusQueueRow>>,
): FocusQueueRow {
  const patch = patches[inboxRowKey(item)];
  return patch ? { ...item, ...patch } : item;
}

export function patchRowAfterMutation(
  item: FocusQueueRow,
  jobId: string,
): FocusQueueRow {
  return {
    ...item,
    jobId,
    jobState: "queued",
  };
}

export function patchRowAfterRetry(item: FocusQueueRow): FocusQueueRow {
  return {
    ...item,
    jobState: "queued",
  };
}
