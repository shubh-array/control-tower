import { describe, expect, it } from "vitest";
import {
  resolveHealthQuerySurface,
  resolveQuerySurface,
} from "../../client/src/lib/query-surface.js";

describe("resolveQuerySurface", () => {
  it("preserves last-known-good data when a refresh fails", () => {
    const surface = resolveQuerySurface({
      data: { count: 2 },
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("network"),
    });

    expect(surface.displayData).toEqual({ count: 2 });
    expect(surface.isStale).toBe(true);
    expect(surface.showError).toBe(false);
  });

  it("surfaces a hard error when no cached data exists", () => {
    const surface = resolveQuerySurface({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("network"),
    });

    expect(surface.displayData).toBeUndefined();
    expect(surface.isStale).toBe(false);
    expect(surface.showError).toBe(true);
  });
});

describe("resolveHealthQuerySurface", () => {
  it("does not mark healthy:false as an outage", () => {
    const surface = resolveHealthQuerySurface({
      data: { healthy: false, issues: ["failed jobs"] },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });

    expect(surface.banner).toBe(null);
    expect(surface.showError).toBe(false);
  });

  it("shows unavailable banner on network failure without cached data", () => {
    const surface = resolveHealthQuerySurface({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("network"),
    });

    expect(surface.banner).toBe("unavailable");
    expect(surface.showError).toBe(true);
  });

  it("keeps stale health data visible with unavailable banner on refresh failure", () => {
    const surface = resolveHealthQuerySurface({
      data: { healthy: true, issues: [] },
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("network"),
    });

    expect(surface.displayData).toEqual({ healthy: true, issues: [] });
    expect(surface.banner).toBe("unavailable");
    expect(surface.isStale).toBe(true);
  });

  it("shows no outage banner while the first health request is pending", () => {
    const surface = resolveHealthQuerySurface({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });

    expect(surface.banner).toBe(null);
    expect(surface.showError).toBe(false);
  });
});
