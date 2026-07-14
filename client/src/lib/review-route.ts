import type { FocusQueueRow } from "./api.js";

export type ReviewRouteResolution =
  | { kind: "navigation"; item: FocusQueueRow }
  | { kind: "queue"; item: FocusQueueRow }
  | { kind: "missing" }
  | { kind: "load-error" };

export function resolveReviewNavigationItem(
  jobId: string,
  navigationItem: FocusQueueRow | undefined,
): FocusQueueRow | null {
  if (navigationItem?.jobId === jobId) {
    return navigationItem;
  }
  return null;
}

export function findReviewQueueItem(
  jobId: string,
  rows: FocusQueueRow[],
): FocusQueueRow | null {
  return rows.find((row) => row.jobId === jobId) ?? null;
}

export function collectQueueRows(queue: {
  focusQueue: {
    now: FocusQueueRow[];
    next: FocusQueueRow[];
    monitor: FocusQueueRow[];
  };
}): FocusQueueRow[] {
  return [
    ...queue.focusQueue.now,
    ...queue.focusQueue.next,
    ...queue.focusQueue.monitor,
  ];
}

export function resolveReviewRoute(input: {
  jobId: string;
  navigationItem?: FocusQueueRow;
  queueRows?: FocusQueueRow[];
  queueError?: boolean;
}): ReviewRouteResolution {
  const fromNavigation = resolveReviewNavigationItem(
    input.jobId,
    input.navigationItem,
  );
  if (fromNavigation) {
    return { kind: "navigation", item: fromNavigation };
  }

  if (input.queueError) {
    return { kind: "load-error" };
  }

  if (input.queueRows === undefined) {
    return { kind: "missing" };
  }

  const fromQueue = findReviewQueueItem(input.jobId, input.queueRows);
  if (fromQueue) {
    return { kind: "queue", item: fromQueue };
  }

  return { kind: "missing" };
}
