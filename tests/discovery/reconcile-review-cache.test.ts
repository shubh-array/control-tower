import { describe, it, expect, vi } from "vitest";
import {
  reconcileReviewCache,
  reviewPrIdentityKey,
  type ReconcileReviewCacheDeps,
  type PersistedReviewPrIdentity,
} from "../../src/discovery/reconcile-review-cache.js";
import type { DiscoveredPr } from "../../src/github/types.js";
import type { PolicyDecision } from "../../src/policy/evaluate.js";

const eligibleDecision: PolicyDecision = {
  eligible: true,
  eligibilityReasons: [],
  exclusionReasons: [],
  authorOnly: false,
  priorityStatus: "p1",
  prioritySortOrdinal: 1,
  priorityReasons: [],
  allPriorityReasons: [],
  selectedPriorityReason: null,
  analysisMode: "auto",
  autoAnalyzeReasons: [],
  selectedDomains: [],
  allDomainReasons: [],
};

const ineligibleDecision: PolicyDecision = {
  ...eligibleDecision,
  eligible: false,
  exclusionReasons: [
    { code: "inactive_repository", githubOwnerRepo: "Powered-By-Array/pba-webapp" },
  ],
};

const persistedRow: PersistedReviewPrIdentity = {
  repositoryId: "pba-webapp",
  github: "Powered-By-Array/pba-webapp",
  prNumber: 99,
};

function samplePr(state: string, overrides: Partial<DiscoveredPr> = {}): DiscoveredPr {
  return {
    repositoryId: "pba-webapp",
    githubOwnerRepo: "Powered-By-Array/pba-webapp",
    prNumber: 99,
    title: "Stale cache PR",
    url: "https://github.com/Powered-By-Array/pba-webapp/pull/99",
    state,
    isDraft: false,
    authorLogin: "alice",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    labels: [],
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-09T14:30:00Z",
    changedFiles: [],
    unsafeFiles: [],
    reviewRequests: [],
    checks: [],
    reviews: [],
    comments: [],
    explicitRequest: false,
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<ReconcileReviewCacheDeps> = {},
): ReconcileReviewCacheDeps {
  return {
    listPersistedReviewPrs: vi.fn().mockReturnValue([persistedRow]),
    enrichPr: vi.fn().mockResolvedValue({ number: 99, state: "OPEN" }),
    normalizePr: vi.fn().mockReturnValue(samplePr("OPEN")),
    evaluatePolicy: vi.fn().mockReturnValue(eligibleDecision),
    upsertEligiblePr: vi.fn().mockReturnValue(42),
    enqueueEligible: vi.fn(),
    queueRetirement: vi.fn(),
    ...overrides,
  };
}

describe("reviewPrIdentityKey", () => {
  it("formats owner/repo and pr number", () => {
    expect(
      reviewPrIdentityKey({ github: "Powered-By-Array/pba-webapp", prNumber: 7 }),
    ).toBe("Powered-By-Array/pba-webapp#7");
  });
});

describe("reconcileReviewCache", () => {
  it("keeps a persisted PR when GitHub confirms it remains open and eligible", async () => {
    const deps = makeDeps();
    const currentEligibleKeys = new Set<string>();

    await reconcileReviewCache(deps, currentEligibleKeys);

    expect(deps.enrichPr).toHaveBeenCalledWith(
      "Powered-By-Array/pba-webapp",
      99,
    );
    expect(deps.normalizePr).toHaveBeenCalledWith(
      expect.anything(),
      "pba-webapp",
      false,
    );
    expect(deps.upsertEligiblePr).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 99, state: "OPEN" }),
      eligibleDecision,
    );
    expect(deps.enqueueEligible).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ prNumber: 99 }),
      eligibleDecision,
    );
    expect(deps.queueRetirement).not.toHaveBeenCalled();
  });

  it("queues retirement when GitHub confirms it is closed", async () => {
    const deps = makeDeps({
      normalizePr: vi.fn().mockReturnValue(samplePr("CLOSED")),
    });

    await reconcileReviewCache(deps, new Set());

    expect(deps.queueRetirement).toHaveBeenCalledWith("pba-webapp", 99);
    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
    expect(deps.enqueueEligible).not.toHaveBeenCalled();
  });

  it("queues retirement when GitHub confirms it is merged", async () => {
    const deps = makeDeps({
      normalizePr: vi.fn().mockReturnValue(samplePr("MERGED")),
    });

    await reconcileReviewCache(deps, new Set());

    expect(deps.queueRetirement).toHaveBeenCalledWith("pba-webapp", 99);
    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
  });

  it("queues retirement when GitHub confirms open but policy is ineligible", async () => {
    const deps = makeDeps({
      evaluatePolicy: vi.fn().mockReturnValue(ineligibleDecision),
    });

    await reconcileReviewCache(deps, new Set());

    expect(deps.queueRetirement).toHaveBeenCalledWith("pba-webapp", 99);
    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
    expect(deps.enqueueEligible).not.toHaveBeenCalled();
  });

  it("retains a persisted PR when enrichPr returns null", async () => {
    const deps = makeDeps({
      enrichPr: vi.fn().mockResolvedValue(null),
    });

    await reconcileReviewCache(deps, new Set());

    expect(deps.normalizePr).not.toHaveBeenCalled();
    expect(deps.queueRetirement).not.toHaveBeenCalled();
    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
  });

  it("propagates enrichPr errors instead of retaining the row", async () => {
    const deps = makeDeps({
      enrichPr: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
    });

    await expect(reconcileReviewCache(deps, new Set())).rejects.toThrow("ENOTFOUND");

    expect(deps.normalizePr).not.toHaveBeenCalled();
    expect(deps.queueRetirement).not.toHaveBeenCalled();
    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
  });

  it("skips persisted rows still present in the current eligible key set", async () => {
    const deps = makeDeps();
    const key = reviewPrIdentityKey(persistedRow);

    await reconcileReviewCache(deps, new Set([key]));

    expect(deps.enrichPr).not.toHaveBeenCalled();
    expect(deps.queueRetirement).not.toHaveBeenCalled();
    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
  });
});
