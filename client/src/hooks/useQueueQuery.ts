import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { isDocumentVisible } from "../lib/document-visibility.js";
import {
  queueHasActiveJob,
  resolveQueueRefetchInterval,
} from "../lib/queue-polling.js";
import { queryKeys } from "../lib/query-keys.js";
import { collectQueueRows } from "../lib/review-route.js";
import { resolveQuerySurface } from "../lib/query-surface.js";

export function useQueueQuery() {
  const query = useQuery({
    queryKey: queryKeys.queue,
    queryFn: () => api.getQueue(),
    refetchInterval: (queryState) => {
      const rows = queryState.state.data
        ? collectQueueRows(queryState.state.data)
        : [];
      return resolveQueueRefetchInterval({
        isVisible: isDocumentVisible(),
        hasActiveJob: queueHasActiveJob(rows),
      });
    },
    refetchIntervalInBackground: false,
  });

  const { refetch } = query;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (isDocumentVisible()) {
        void refetch();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refetch]);

  const surface = resolveQuerySurface({
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  });

  return {
    ...query,
    surface,
    focusQueue: query.data?.focusQueue,
    retry: query.refetch,
  };
}
