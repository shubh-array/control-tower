import { useQuery } from "@tanstack/react-query";
import { ApiError, api, type DraftDetail } from "../lib/api.js";
import { queryKeys } from "../lib/query-keys.js";
import { resolveDraftQuerySurface } from "../lib/query-surface.js";

export function useDraftQuery(
  jobId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const enabled = Boolean(jobId) && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: queryKeys.draft(jobId ?? ""),
    queryFn: () => api.getDraft(jobId!),
    enabled,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) {
        return false;
      }
      return failureCount < 1;
    },
  });

  const surface = resolveDraftQuerySurface<DraftDetail>({
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
