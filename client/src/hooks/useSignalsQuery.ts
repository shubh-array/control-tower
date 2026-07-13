import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/query-keys.js";
import { resolveQuerySurface } from "../lib/query-surface.js";

export function useSignalsQuery(limit = 50) {
  const query = useQuery({
    queryKey: queryKeys.signals(limit),
    queryFn: () => api.getSignals(limit),
  });

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
    signals: query.data ?? [],
    retry: query.refetch,
  };
}
