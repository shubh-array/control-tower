import { describe, expect, it } from "vitest";
import {
  resolveConnectionPresentation,
  resolveRefreshPresentation,
} from "../../client/src/lib/shell-status.js";

describe("resolveConnectionPresentation", () => {
  it("reports checking while the first health request is pending", () => {
    expect(
      resolveConnectionPresentation({
        isLoading: true,
        isError: false,
        hasCachedData: false,
      }),
    ).toEqual({
      state: "checking",
      label: "Checking connection",
    });
  });

  it("reports unavailable when health cannot be reached", () => {
    expect(
      resolveConnectionPresentation({
        isLoading: false,
        isError: true,
        hasCachedData: false,
      }),
    ).toEqual({
      state: "unavailable",
      label: "Connection unavailable",
    });
  });

  it("reports connected when health data is available", () => {
    expect(
      resolveConnectionPresentation({
        isLoading: false,
        isError: false,
        hasCachedData: true,
      }),
    ).toEqual({
      state: "connected",
      label: "Connected",
    });
  });
});

describe("resolveRefreshPresentation", () => {
  it("reports refreshing while a fetch is in flight", () => {
    expect(
      resolveRefreshPresentation({
        isFetching: true,
        isStale: false,
      }),
    ).toEqual({
      tone: "refreshing",
      label: "Refreshing data",
    });
  });

  it("reports stale when cached data failed to refresh", () => {
    expect(
      resolveRefreshPresentation({
        isFetching: false,
        isStale: true,
      }),
    ).toEqual({
      tone: "stale",
      label: "Showing cached data",
    });
  });

  it("reports idle when data is current", () => {
    expect(
      resolveRefreshPresentation({
        isFetching: false,
        isStale: false,
      }),
    ).toEqual({
      tone: "idle",
      label: "Data is current",
    });
  });
});
