import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitTracker } from "../../src/github/rate-limit.js";

describe("RateLimitTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes and stores rate limit resources", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));

    const execGhJson = vi.fn().mockResolvedValue({
      resources: {
        core: { limit: 5000, remaining: 4999, reset: 1_783_684_860 },
        search: { limit: 30, remaining: 29, reset: 1_783_684_860 },
        graphql: { limit: 5000, remaining: 4998, reset: 1_783_684_860 },
      },
    });

    const tracker = new RateLimitTracker();
    const state = await tracker.refresh("github.com", execGhJson);

    expect(execGhJson).toHaveBeenCalledWith(["api", "rate_limit"], {
      host: "github.com",
    });
    expect(state).toEqual({
      core: { limit: 5000, remaining: 4999, reset: 1_783_684_860 },
      search: { limit: 30, remaining: 29, reset: 1_783_684_860 },
      graphql: { limit: 5000, remaining: 4998, reset: 1_783_684_860 },
      lastChecked: "2026-07-10T12:00:00.000Z",
    });
    expect(tracker.getState()).toEqual(state);
  });

  it("reports exhausted resources unavailable until reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));

    const execGhJson = vi.fn().mockResolvedValue({
      resources: {
        core: { limit: 5000, remaining: 0, reset: 1_783_684_860 },
        search: { limit: 30, remaining: 10, reset: 1_783_684_860 },
        graphql: { limit: 5000, remaining: 1, reset: 1_783_684_860 },
      },
    });

    const tracker = new RateLimitTracker();
    await tracker.refresh("github.com", execGhJson);

    expect(tracker.isAvailable("core")).toBe(false);
    expect(tracker.resetTime("core")).toEqual(new Date(1_783_684_860_000));

    vi.setSystemTime(new Date(1_783_684_860_000));

    expect(tracker.isAvailable("core")).toBe(true);
  });

  it("treats missing resources as available", () => {
    const tracker = new RateLimitTracker();

    expect(tracker.isAvailable("core")).toBe(true);
    expect(tracker.resetTime("core")).toBeNull();
  });
});
