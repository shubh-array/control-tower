import { ApiError } from "./api.js";
import {
  resolveHealthBanner,
  type HealthBanner,
} from "./health-request.js";

export type QuerySurface<T> = {
  data: T | undefined;
  displayData: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  error: Error | null;
  showError: boolean;
};

export type HealthQuerySurface = QuerySurface<{
  healthy: boolean;
  issues: string[];
}> & {
  banner: HealthBanner;
};

export type DraftQuerySurface<T> = QuerySurface<T> & {
  isMissingDraft: boolean;
};

export function resolveQuerySurface<T>(input: {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
}): QuerySurface<T> {
  const hasCachedData = input.data !== undefined;

  return {
    data: input.data,
    displayData: input.data,
    isLoading: input.isLoading && !hasCachedData,
    isFetching: input.isFetching,
    isStale: input.isError && hasCachedData,
    isError: input.isError,
    error: input.error,
    showError: input.isError && !hasCachedData,
  };
}

export function resolveHealthQuerySurface(input: {
  data: { healthy: boolean; issues: string[] } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
}): HealthQuerySurface {
  const surface = resolveQuerySurface(input);
  const banner = input.isError
    ? resolveHealthBanner({ kind: "error" })
    : input.data
      ? resolveHealthBanner({
          kind: "ok",
          healthy: input.data.healthy,
          issues: input.data.issues,
        })
      : null;

  return {
    ...surface,
    banner,
  };
}

export function resolveDraftQuerySurface<T>(input: {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
}): DraftQuerySurface<T> {
  const surface = resolveQuerySurface(input);
  const isMissingDraft =
    input.isError &&
    input.data === undefined &&
    input.error instanceof ApiError &&
    input.error.status === 404;

  return {
    ...surface,
    isMissingDraft,
  };
}
