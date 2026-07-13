import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { isDocumentVisible } from "../lib/document-visibility.js";
import { HEALTH_POLL_MS } from "../lib/queue-polling.js";
import { queryKeys } from "../lib/query-keys.js";
import { resolveHealthQuerySurface } from "../lib/query-surface.js";

export function useHealthQuery() {
  const query = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.getHealth(),
    refetchInterval: () =>
      isDocumentVisible() ? HEALTH_POLL_MS : false,
    refetchIntervalInBackground: false,
  });

  const surface = resolveHealthQuerySurface({
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  });

  return {
    ...query,
    surface,
    retry: query.refetch,
  };
}
