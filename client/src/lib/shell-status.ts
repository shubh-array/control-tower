export type ConnectionState = "connected" | "unavailable" | "checking";

export type ConnectionPresentation = {
  state: ConnectionState;
  label: string;
};

export type RefreshTone = "idle" | "refreshing" | "stale";

export type RefreshPresentation = {
  tone: RefreshTone;
  label: string;
};

export function resolveConnectionPresentation(input: {
  isLoading: boolean;
  isError: boolean;
  hasCachedData: boolean;
}): ConnectionPresentation {
  if (input.isError && !input.hasCachedData) {
    return {
      state: "unavailable",
      label: "Connection unavailable",
    };
  }

  if (input.isLoading && !input.hasCachedData) {
    return {
      state: "checking",
      label: "Checking connection",
    };
  }

  if (input.isError) {
    return {
      state: "unavailable",
      label: "Connection unavailable",
    };
  }

  return {
    state: "connected",
    label: "Connected",
  };
}

export function resolveRefreshPresentation(input: {
  isFetching: boolean;
  isStale: boolean;
}): RefreshPresentation {
  if (input.isFetching) {
    return {
      tone: "refreshing",
      label: "Refreshing data",
    };
  }

  if (input.isStale) {
    return {
      tone: "stale",
      label: "Showing cached data",
    };
  }

  return {
    tone: "idle",
    label: "Data is current",
  };
}
