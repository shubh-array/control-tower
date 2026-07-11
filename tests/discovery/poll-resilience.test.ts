import { describe, it, expect, vi } from "vitest";
import {
  ResilientPoller,
  scheduleBackoff,
  type PollResult,
  type ResilientPollDeps,
} from "../../src/discovery/poll-resilience.js";
import { RateLimitTracker } from "../../src/github/rate-limit.js";
import type { HostHealth } from "../../src/github/types.js";

function healthyHost(): HostHealth {
  return {
    host: "github.com",
    healthy: true,
    authenticatedLogin: "shubh-array",
    checkedAt: "2026-07-10T12:00:00.000Z",
  };
}

function mismatchHost(): HostHealth {
  return {
    host: "github.com",
    healthy: false,
    authenticatedLogin: "wrong-user",
    error: "Login mismatch: expected shubh-array, got wrong-user",
    checkedAt: "2026-07-10T12:00:00.000Z",
  };
}

function makeDeps(overrides?: Partial<ResilientPollDeps>): ResilientPollDeps {
  const rateLimits = new RateLimitTracker();
  return {
    verifyIdentity: vi.fn().mockResolvedValue(healthyHost()),
    searchReviewRequested: vi.fn().mockResolvedValue([
      {
        number: 101,
        title: "Add auth middleware",
        url: "https://github.com/Powered-By-Array/pba-webapp/pull/101",
        state: "OPEN",
        isDraft: false,
        author: { login: "alice" },
        repository: { nameWithOwner: "Powered-By-Array/pba-webapp" },
        headRefOid: "abc123",
        baseRefOid: "def456",
        labels: [],
        additions: 0,
        deletions: 0,
        createdAt: "2026-07-01T10:00:00Z",
        updatedAt: "2026-07-09T14:30:00Z",
        reviewRequests: [],
      },
    ]),
    listRepoPrs: vi.fn().mockResolvedValue([]),
    upsertRepository: vi.fn(),
    upsertPr: vi.fn().mockReturnValue(1),
    evaluateAndEnqueue: vi.fn().mockReturnValue(undefined),
    countKnownPrs: vi.fn().mockReturnValue(3),
    getFreshnessAt: vi.fn().mockReturnValue("2026-07-10T11:55:00.000Z"),
    setFreshnessAt: vi.fn(),
    rateLimits,
    scheduleNextPoll: vi.fn(),
    config: {
      host: "github.com",
      organizations: ["Powered-By-Array"],
      operatorLogin: "shubh-array",
      activeRepositoryIds: ["pba-webapp"],
      repositories: [{ id: "pba-webapp", github: "Powered-By-Array/pba-webapp" }],
      baseBackoffMs: 5_000,
      maxBackoffMs: 300_000,
    },
    random: () => 0.5,
    ...overrides,
  };
}

describe("scheduleBackoff", () => {
  it("applies exponential backoff with jitter within [0.5, 1.5) of base", () => {
    const delays: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      delays.push(
        scheduleBackoff({
          attempt,
          baseBackoffMs: 1_000,
          maxBackoffMs: 60_000,
          random: () => 0.0,
        }),
      );
    }
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(1_000);
    expect(delays[2]).toBe(2_000);
    expect(delays[3]).toBe(4_000);
    expect(delays[4]).toBe(8_000);
  });

  it("caps at maxBackoffMs including jitter upper bound", () => {
    const delay = scheduleBackoff({
      attempt: 20,
      baseBackoffMs: 5_000,
      maxBackoffMs: 30_000,
      random: () => 0.999,
    });
    expect(delay).toBeLessThanOrEqual(30_000 * 1.5);
    expect(delay).toBeGreaterThanOrEqual(30_000 * 0.5);
  });
});

describe("ResilientPoller — network / gh throw", () => {
  it("preserves last-known DB rows and returns coverageComplete:false on gh throw", async () => {
    const deps = makeDeps({
      searchReviewRequested: vi
        .fn()
        .mockRejectedValue(new Error("ENOTFOUND api.github.com")),
    });
    const poller = new ResilientPoller(deps);

    const result: PollResult = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.hostHealthy).toBe(true);
    expect(result.freshnessAt).toBe("2026-07-10T11:55:00.000Z");
    expect(deps.countKnownPrs).toHaveBeenCalled();
    expect(deps.upsertPr).not.toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.setFreshnessAt).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
    const scheduledMs = (deps.scheduleNextPoll as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as number;
    expect(scheduledMs).toBeGreaterThanOrEqual(deps.config.baseBackoffMs * 0.5);
    expect(scheduledMs).toBeLessThanOrEqual(deps.config.baseBackoffMs * 1.5);
  });

  it("preserves last-known rows on generic network error from listRepoPrs", async () => {
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([]),
      listRepoPrs: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.freshnessAt).toBe("2026-07-10T11:55:00.000Z");
    expect(result.knownPrCount).toBe(3);
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
  });
});

describe("ResilientPoller — rate limit", () => {
  it("returns coverageComplete:false, preserves rows, and uses RateLimitTracker", async () => {
    const rateLimits = new RateLimitTracker();
    (
      rateLimits as unknown as {
        state: {
          core: { limit: number; remaining: number; reset: number };
          search: { limit: number; remaining: number; reset: number };
          graphql: { limit: number; remaining: number; reset: number };
          lastChecked: string;
        };
      }
    ).state = {
      core: { limit: 5000, remaining: 5000, reset: 4_000_000_000 },
      search: { limit: 30, remaining: 0, reset: 4_000_000_000 },
      graphql: { limit: 5000, remaining: 5000, reset: 4_000_000_000 },
      lastChecked: "2026-07-10T12:00:00.000Z",
    };

    const deps = makeDeps({ rateLimits });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.hostHealthy).toBe(true);
    expect(result.freshnessAt).toBe("2026-07-10T11:55:00.000Z");
    expect(result.reason).toMatch(/rate.?limit/i);
    expect(deps.searchReviewRequested).not.toHaveBeenCalled();
    expect(deps.listRepoPrs).not.toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
    expect(rateLimits.isAvailable("search")).toBe(false);
    expect(rateLimits.resetTime("search")).toBeInstanceOf(Date);
  });

  it("on HTTP 403 rate-limit throw from gh, refreshes tracker and backs off", async () => {
    const rateLimits = new RateLimitTracker();
    const refresh = vi.spyOn(rateLimits, "refresh").mockResolvedValue({
      core: { limit: 5000, remaining: 0, reset: 4_000_000_000 },
      search: { limit: 30, remaining: 0, reset: 4_000_000_000 },
      graphql: { limit: 5000, remaining: 5000, reset: 4_000_000_000 },
      lastChecked: "2026-07-10T12:00:00.000Z",
    });
    const deps = makeDeps({
      rateLimits,
      searchReviewRequested: vi.fn().mockRejectedValue(
        Object.assign(new Error("API rate limit exceeded"), { status: 403 }),
      ),
      execGhJson: vi.fn(),
    });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.freshnessAt).toBe("2026-07-10T11:55:00.000Z");
    expect(refresh).toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
  });
});

describe("ResilientPoller — operator identity mismatch", () => {
  it("sets hostHealthy=false, skips search/list, and does not call enqueue", async () => {
    const deps = makeDeps({
      verifyIdentity: vi.fn().mockResolvedValue(mismatchHost()),
    });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.hostHealthy).toBe(false);
    expect(result.coverageComplete).toBe(false);
    expect(result.freshnessAt).toBe("2026-07-10T11:55:00.000Z");
    expect(result.reason).toMatch(/mismatch|unhealthy/i);
    expect(deps.searchReviewRequested).not.toHaveBeenCalled();
    expect(deps.listRepoPrs).not.toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.upsertPr).not.toHaveBeenCalled();
    expect(deps.setFreshnessAt).not.toHaveBeenCalled();
  });
});

describe("ResilientPoller — enrichPr", () => {
  it("invokes enrichPr when provided on deps", async () => {
    const enrichPr = vi.fn().mockResolvedValue(null);
    const deps = makeDeps({ enrichPr });
    const poller = new ResilientPoller(deps);

    await poller.poll();

    expect(enrichPr).toHaveBeenCalledWith("Powered-By-Array/pba-webapp", 101);
  });
});

describe("ResilientPoller — success path", () => {
  it("marks coverageComplete and updates freshness on successful poll", async () => {
    const deps = makeDeps();
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(true);
    expect(result.hostHealthy).toBe(true);
    expect(result.freshnessAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deps.searchReviewRequested).toHaveBeenCalledWith(
      "shubh-array",
      ["Powered-By-Array"],
    );
    expect(deps.listRepoPrs).toHaveBeenCalledWith("Powered-By-Array/pba-webapp");
    expect(deps.evaluateAndEnqueue).toHaveBeenCalled();
    expect(deps.setFreshnessAt).toHaveBeenCalledWith(
      "github.com",
      expect.any(String),
    );
    expect(deps.scheduleNextPoll).not.toHaveBeenCalled();
  });
});
