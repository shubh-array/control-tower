import { describe, expect, it } from "vitest";
import { ApiError } from "../../client/src/lib/api.js";
import { resolveDraftQuerySurface } from "../../client/src/lib/query-surface.js";

describe("resolveDraftQuerySurface", () => {
  it("exposes missing-draft errors for recovery without hiding them", () => {
    const surface = resolveDraftQuerySurface({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new ApiError(404, "not found"),
    });

    expect(surface.showError).toBe(true);
    expect(surface.isMissingDraft).toBe(true);
    expect(surface.displayData).toBeUndefined();
  });

  it("preserves last-known-good draft data on transient refresh failure", () => {
    const draft = { jobId: "job-1", runId: "run-1" };
    const surface = resolveDraftQuerySurface({
      data: draft,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("network"),
    });

    expect(surface.displayData).toEqual(draft);
    expect(surface.isStale).toBe(true);
    expect(surface.isMissingDraft).toBe(false);
    expect(surface.showError).toBe(false);
  });
});
