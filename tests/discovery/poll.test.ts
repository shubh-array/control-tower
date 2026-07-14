import { describe, it, expect, vi } from "vitest";
import { DiscoveryPoller, type DiscoveryDeps } from "../../src/discovery/poll.js";
import type { HostHealth, DiscoveredPr } from "../../src/github/types.js";

function healthyHost(): HostHealth {
  return {
    host: "github.com",
    healthy: true,
    authenticatedLogin: "shubh-array",
    checkedAt: new Date().toISOString(),
  };
}

function unhealthyHost(): HostHealth {
  return {
    host: "github.com",
    healthy: false,
    authenticatedLogin: "wrong-user",
    error: "Login mismatch",
    checkedAt: new Date().toISOString(),
  };
}

function makeDeps(overrides?: Partial<DiscoveryDeps>): DiscoveryDeps {
  return {
    verifyIdentity: vi.fn().mockResolvedValue(healthyHost()),
    searchReviewRequested: vi.fn().mockResolvedValue([]),
    listRepoPrs: vi.fn().mockResolvedValue([]),
    enrichPr: vi.fn().mockResolvedValue(null),
    normalizePr: vi.fn().mockReturnValue({
      repositoryId: "test",
      githubOwnerRepo: "Org/test",
      prNumber: 1,
      title: "Test",
      url: "",
      state: "OPEN",
      isDraft: false,
      authorLogin: "alice",
      headSha: "abc",
      baseSha: "def",
      labels: [],
      additions: 0,
      deletions: 0,
      createdAt: "",
      updatedAt: "",
      changedFiles: [],
      unsafeFiles: [],
      reviewRequests: [],
      checks: [],
      reviews: [],
      comments: [],
      explicitRequest: false,
    } satisfies DiscoveredPr),
    upsertRepository: vi.fn(),
    upsertEligiblePr: vi.fn().mockReturnValue(1),
    retireReviewPr: vi.fn().mockResolvedValue(undefined),
    listPersistedReviewPrs: vi.fn().mockReturnValue([]),
    enqueueEligible: vi.fn(),
    evaluatePolicy: vi.fn().mockReturnValue({
      eligible: true,
      eligibilityReasons: [],
      exclusionReasons: [],
      authorOnly: false,
      priorityStatus: "p3",
      prioritySortOrdinal: 3,
      priorityReasons: [],
      allPriorityReasons: [],
      selectedPriorityReason: null,
      analysisMode: "on_demand",
      autoAnalyzeReasons: [],
      selectedDomains: [],
      allDomainReasons: [],
    }),
    checkpoint: {
      getLastPollTime: vi.fn().mockReturnValue(null),
      setLastPollTime: vi.fn(),
    },
    config: {
      host: "github.com",
      organizations: ["Powered-By-Array"],
      operatorLogin: "shubh-array",
      activeRepositoryIds: ["pba-webapp"],
      repositories: [{ id: "pba-webapp", github: "Powered-By-Array/pba-webapp" }],
      pollIntervalSeconds: 300,
    },
    ...overrides,
  };
}

describe("DiscoveryPoller", () => {
  it("verifies operator identity before polling", async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.verifyIdentity).toHaveBeenCalledOnce();
  });

  it("skips polling when host is unhealthy", async () => {
    const deps = makeDeps({
      verifyIdentity: vi.fn().mockResolvedValue(unhealthyHost()),
    });
    const poller = new DiscoveryPoller(deps);

    const result = await poller.poll();

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/unhealthy/i);
    expect(deps.searchReviewRequested).not.toHaveBeenCalled();
    expect(deps.listRepoPrs).not.toHaveBeenCalled();
  });

  it("searches for explicit review requests using exact operator login", async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.searchReviewRequested).toHaveBeenCalledWith(
      "shubh-array",
      ["Powered-By-Array"],
    );
  });

  it("lists PRs for each active repository", async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.listRepoPrs).toHaveBeenCalledWith("Powered-By-Array/pba-webapp");
  });

  it("records checkpoint after successful poll", async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.checkpoint.setLastPollTime).toHaveBeenCalledWith("github.com");
  });

  it("on-demand refresh triggers immediate poll", async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.refresh();

    expect(deps.verifyIdentity).toHaveBeenCalledOnce();
    expect(deps.searchReviewRequested).toHaveBeenCalledOnce();
  });

  it("deduplicates PRs seen from both search and list", async () => {
    const prItem = {
      number: 42,
      repository: { nameWithOwner: "Powered-By-Array/pba-webapp" },
    };
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([prItem]),
      listRepoPrs: vi.fn().mockResolvedValue([{ ...prItem }]),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.upsertEligiblePr).toHaveBeenCalledOnce();
  });

  it("upserts repository before PR for FK safety", async () => {
    const prItem = {
      number: 42,
      repository: { nameWithOwner: "Powered-By-Array/pba-webapp" },
    };
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([prItem]),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.upsertRepository).toHaveBeenCalledWith({
      id: "pba-webapp",
      github: "Powered-By-Array/pba-webapp",
      host: "github.com",
    });
    expect(deps.upsertRepository).toHaveBeenCalledBefore(
      deps.upsertEligiblePr as ReturnType<typeof vi.fn>,
    );
  });

  it("skips polling when rate limit is exhausted", async () => {
    const deps = makeDeps({
      rateLimit: {
        isAvailable: vi.fn().mockReturnValue(false),
      },
    });
    const poller = new DiscoveryPoller(deps);

    const result = await poller.poll();

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/rate.?limit/i);
    expect(deps.searchReviewRequested).not.toHaveBeenCalled();
    expect(deps.listRepoPrs).not.toHaveBeenCalled();
  });

  it("calls enrichPr before normalize when enrich returns data", async () => {
    const prItem = {
      number: 42,
      repository: { nameWithOwner: "Powered-By-Array/pba-webapp" },
    };
    const enriched = { ...prItem, title: "Enriched" };
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([prItem]),
      enrichPr: vi.fn().mockResolvedValue(enriched),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.enrichPr).toHaveBeenCalledWith(
      "Powered-By-Array/pba-webapp",
      42,
    );
    expect(deps.normalizePr).toHaveBeenCalledWith(
      enriched,
      "pba-webapp",
      true,
    );
  });

  it("does not persist or enqueue when policy marks PR ineligible", async () => {
    const prItem = {
      number: 42,
      repository: { nameWithOwner: "Powered-By-Array/pba-webapp" },
    };
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([prItem]),
      normalizePr: vi.fn().mockReturnValue({
        repositoryId: "pba-webapp",
        githubOwnerRepo: "Powered-By-Array/pba-webapp",
        prNumber: 42,
        title: "Test",
        url: "",
        state: "OPEN",
        isDraft: false,
        authorLogin: "alice",
        headSha: "abc",
        baseSha: "def",
        labels: [],
        additions: 0,
        deletions: 0,
        createdAt: "",
        updatedAt: "",
        changedFiles: [],
        unsafeFiles: [],
        reviewRequests: [],
        checks: [],
        reviews: [],
        comments: [],
        explicitRequest: true,
      } satisfies DiscoveredPr),
      evaluatePolicy: vi.fn().mockReturnValue({
        eligible: false,
        eligibilityReasons: [],
        exclusionReasons: [
          { code: "inactive_repository", githubOwnerRepo: "Powered-By-Array/pba-webapp" },
        ],
        authorOnly: false,
        priorityStatus: "p3" as const,
        prioritySortOrdinal: 3,
        priorityReasons: [],
        allPriorityReasons: [],
        selectedPriorityReason: null,
        analysisMode: "on_demand" as const,
        autoAnalyzeReasons: [],
        selectedDomains: [],
        allDomainReasons: [],
      }),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
    expect(deps.enqueueEligible).not.toHaveBeenCalled();
    expect(deps.retireReviewPr).toHaveBeenCalledWith("pba-webapp", 42);
  });

  it("defers retirements until poll succeeds and applies none when a later enrich throws", async () => {
    const pr42 = { number: 42 };
    const pr55 = { number: 55 };
    const ineligibleDecision = {
      eligible: false,
      eligibilityReasons: [],
      exclusionReasons: [
        { code: "inactive_repository", githubOwnerRepo: "Powered-By-Array/pba-webapp" },
      ],
      authorOnly: false,
      priorityStatus: "p3" as const,
      prioritySortOrdinal: 3,
      priorityReasons: [],
      allPriorityReasons: [],
      selectedPriorityReason: null,
      analysisMode: "on_demand" as const,
      autoAnalyzeReasons: [],
      selectedDomains: [],
      allDomainReasons: [],
    };
    const enrichPr = vi
      .fn()
      .mockResolvedValueOnce({ number: 42, state: "OPEN" })
      .mockRejectedValueOnce(new Error("ENOTFOUND api.github.com"));
    const normalizePr = vi.fn().mockImplementation(
      (raw: { number: number }, repositoryId: string, explicitRequest: boolean) =>
        ({
          repositoryId,
          githubOwnerRepo: "Powered-By-Array/pba-webapp",
          prNumber: raw.number,
          title: "Test",
          url: "",
          state: "OPEN",
          isDraft: false,
          authorLogin: "alice",
          headSha: "abc",
          baseSha: "def",
          labels: [],
          additions: 0,
          deletions: 0,
          createdAt: "",
          updatedAt: "",
          changedFiles: [],
          unsafeFiles: [],
          reviewRequests: [],
          checks: [],
          reviews: [],
          comments: [],
          explicitRequest,
        }) satisfies DiscoveredPr,
    );
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([]),
      listRepoPrs: vi.fn().mockResolvedValue([pr42, pr55]),
      enrichPr,
      normalizePr,
      evaluatePolicy: vi.fn().mockImplementation((pr: DiscoveredPr) =>
        pr.prNumber === 42
          ? ineligibleDecision
          : {
              eligible: true,
              eligibilityReasons: [],
              exclusionReasons: [],
              authorOnly: false,
              priorityStatus: "p1" as const,
              prioritySortOrdinal: 1,
              priorityReasons: [],
              allPriorityReasons: [],
              selectedPriorityReason: null,
              analysisMode: "auto" as const,
              autoAnalyzeReasons: [],
              selectedDomains: [],
              allDomainReasons: [],
            },
      ),
    });
    const poller = new DiscoveryPoller(deps);

    await expect(poller.poll()).rejects.toThrow("ENOTFOUND");

    expect(deps.retireReviewPr).not.toHaveBeenCalled();
    expect(deps.checkpoint.setLastPollTime).not.toHaveBeenCalled();
  });

  it("reconciles persisted cache rows after successful poll before checkpoint", async () => {
    const persisted = {
      repositoryId: "pba-webapp",
      github: "Powered-By-Array/pba-webapp",
      prNumber: 99,
    };
    const listPersistedReviewPrs = vi.fn().mockReturnValue([persisted]);
    const enrichPr = vi.fn().mockResolvedValue({ number: 99, state: "OPEN" });
    const deps = makeDeps({
      listRepoPrs: vi.fn().mockResolvedValue([]),
      searchReviewRequested: vi.fn().mockResolvedValue([]),
      listPersistedReviewPrs,
      enrichPr,
      normalizePr: vi.fn().mockImplementation((_raw, repositoryId, explicitRequest) => ({
        repositoryId,
        githubOwnerRepo: "Powered-By-Array/pba-webapp",
        prNumber: explicitRequest ? 42 : 99,
        title: "Test",
        url: "",
        state: "OPEN",
        isDraft: false,
        authorLogin: "alice",
        headSha: "abc",
        baseSha: "def",
        labels: [],
        additions: 0,
        deletions: 0,
        createdAt: "",
        updatedAt: "",
        changedFiles: [],
        unsafeFiles: [],
        reviewRequests: [],
        checks: [],
        reviews: [],
        comments: [],
        explicitRequest,
      } satisfies DiscoveredPr)),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(listPersistedReviewPrs).toHaveBeenCalledOnce();
    expect(enrichPr).toHaveBeenCalledWith("Powered-By-Array/pba-webapp", 99);
    expect(deps.upsertEligiblePr).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 99 }),
      expect.objectContaining({ eligible: true }),
    );
    expect(deps.checkpoint.setLastPollTime).toHaveBeenCalledWith("github.com");
    expect(deps.checkpoint.setLastPollTime).toHaveBeenCalledAfter(
      listPersistedReviewPrs as ReturnType<typeof vi.fn>,
    );
  });

  it("does not reconcile persisted cache rows when poll is skipped", async () => {
    const deps = makeDeps({
      verifyIdentity: vi.fn().mockResolvedValue(unhealthyHost()),
      listPersistedReviewPrs: vi.fn().mockReturnValue([
        {
          repositoryId: "pba-webapp",
          github: "Powered-By-Array/pba-webapp",
          prNumber: 99,
        },
      ]),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.listPersistedReviewPrs).not.toHaveBeenCalled();
    expect(deps.checkpoint.setLastPollTime).not.toHaveBeenCalled();
  });
});
