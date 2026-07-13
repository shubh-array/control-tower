import { useCallback } from "react";
import { useHealthQuery } from "./useHealthQuery.js";
import { useQueueQuery } from "./useQueueQuery.js";
import {
  resolveConnectionPresentation,
  resolveRefreshPresentation,
} from "../lib/shell-status.js";

export function useAppShellState() {
  const health = useHealthQuery();
  const queue = useQueueQuery();

  const connection = resolveConnectionPresentation({
    isLoading: health.isLoading,
    isError: health.isError,
    hasCachedData: health.data !== undefined,
  });

  const refresh = resolveRefreshPresentation({
    isFetching: health.isFetching || queue.isFetching,
    isStale: health.surface.isStale || queue.surface.isStale,
  });

  const handleRefresh = useCallback(() => {
    void health.retry();
    void queue.retry();
  }, [health, queue]);

  return {
    connection,
    refresh,
    showUnavailableBanner: health.surface.banner === "unavailable",
    showStaleBanner:
      health.surface.banner !== "unavailable" &&
      (health.surface.isStale || queue.surface.isStale),
    isRefreshing: health.isFetching || queue.isFetching,
    onRefresh: handleRefresh,
    onRetryConnection: () => {
      void health.retry();
    },
    onRetryRefresh: handleRefresh,
  };
}
