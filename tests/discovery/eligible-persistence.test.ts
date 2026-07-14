import { describe, it, expect, vi, beforeEach } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import {
  DiscoveryPoller,
  type DiscoveryDeps,
} from "../../src/discovery/poll.js";
import {
  upsertEligiblePr,
  deleteReviewPr,
  upsertRepository,
} from "../../src/normalize/upsert.js";
import type { DiscoveredPr, HostHealth } from "../../src/github/types.js";
import type { PolicyDecision } from "../../src/policy/evaluate.js";
import { canonicalJsonSerialize } from "../../src/util/canonical-json.js";
import { sha256OfCanonicalJson } from "../../src/util/hash.js";

function healthyHost(): HostHealth {
  return {
    host: "github.com",
    healthy: true,
    authenticatedLogin: "shubh-array",
    checkedAt: new Date().toISOString(),
  };
}

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

function samplePr(overrides: Partial<DiscoveredPr> = {}): DiscoveredPr {
  return {
    repositoryId: "pba-webapp",
    githubOwnerRepo: "Powered-By-Array/pba-webapp",
    prNumber: 42,
    title: "Test PR",
    url: "https://github.com/Powered-By-Array/pba-webapp/pull/42",
    state: "OPEN",
    isDraft: false,
    authorLogin: "alice",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    labels: [],
    additions: 10,
    deletions: 2,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-09T14:30:00Z",
    changedFiles: ["src/a.ts"],
    unsafeFiles: [],
    reviewRequests: [],
    checks: [
      {
        __typename: "CheckRun",
        name: "CI",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://example.com/ci",
      },
    ],
    reviews: [],
    comments: [],
    explicitRequest: false,
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<DiscoveryDeps> & {
    evaluatePolicy?: ReturnType<typeof vi.fn>;
  } = {},
): DiscoveryDeps {
  const prItem = {
    number: 42,
    repository: { nameWithOwner: "Powered-By-Array/pba-webapp" },
  };
  return {
    verifyIdentity: vi.fn().mockResolvedValue(healthyHost()),
    searchReviewRequested: vi.fn().mockResolvedValue([]),
    listRepoPrs: vi.fn().mockResolvedValue([prItem]),
    enrichPr: vi.fn().mockResolvedValue(null),
    normalizePr: vi.fn().mockReturnValue(samplePr()),
    upsertRepository: vi.fn(),
    upsertEligiblePr: vi.fn().mockReturnValue(1),
    retireReviewPr: vi.fn().mockResolvedValue(undefined),
    listPersistedReviewPrs: vi.fn().mockReturnValue([]),
    enqueueEligible: vi.fn(),
    evaluatePolicy:
      overrides.evaluatePolicy ??
      vi.fn().mockReturnValue(eligibleDecision),
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

describe("DiscoveryPoller — eligibility-gated persistence", () => {
  it("does not persist or enqueue an ineligible discovered PR", async () => {
    const deps = makeDeps({
      evaluatePolicy: vi.fn().mockReturnValue(ineligibleDecision),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.evaluatePolicy).toHaveBeenCalledOnce();
    expect(deps.upsertEligiblePr).not.toHaveBeenCalled();
    expect(deps.enqueueEligible).not.toHaveBeenCalled();
    expect(deps.retireReviewPr).toHaveBeenCalledWith("pba-webapp", 42);
  });

  it("persists once and evaluates/enqueues once for an eligible PR", async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.evaluatePolicy).toHaveBeenCalledOnce();
    expect(deps.upsertEligiblePr).toHaveBeenCalledTimes(1);
    expect(deps.upsertEligiblePr).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 }),
      eligibleDecision,
    );
    expect(deps.enqueueEligible).toHaveBeenCalledTimes(1);
    expect(deps.enqueueEligible).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ prNumber: 42 }),
      eligibleDecision,
    );
    expect(deps.retireReviewPr).not.toHaveBeenCalled();
  });
});

describe("DiscoveryPoller — SQLite eligibility transition", () => {
  let db: ReturnType<typeof openDatabase>;
  let evaluatePolicy: ReturnType<typeof vi.fn>;
  let enqueueEligible: ReturnType<typeof vi.fn>;
  let retireReviewPr: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);
    upsertRepository(db, {
      id: "pba-webapp",
      github: "Powered-By-Array/pba-webapp",
      host: "github.com",
      defaultBranch: "main",
      resourceClass: "medium",
    });

    evaluatePolicy = vi.fn().mockReturnValue(eligibleDecision);
    enqueueEligible = vi.fn();
    retireReviewPr = vi.fn(async (repositoryId: string, prNumber: number) => {
      deleteReviewPr(db, repositoryId, prNumber);
    });
  });

  it("persists policy only for an eligible PR and cascades an eligibility transition", async () => {
    const deps = makeDeps({
      evaluatePolicy,
      upsertEligiblePr: vi.fn((discovered, decision) =>
        upsertEligiblePr(db, discovered, decision),
      ),
      retireReviewPr,
      enqueueEligible,
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    const policyRows = db
      .prepare("SELECT policy_json, policy_hash FROM prs")
      .all() as Array<{ policy_json: string; policy_hash: string }>;
    expect(policyRows).toHaveLength(1);
    expect(policyRows[0]!.policy_json).toBe(canonicalJsonSerialize(eligibleDecision));
    expect(policyRows[0]!.policy_hash).toBe(sha256OfCanonicalJson(eligibleDecision));
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM pr_checks").get() as { count: number })
        .count,
    ).toBe(1);

    evaluatePolicy.mockReturnValue(ineligibleDecision);
    await poller.poll();

    expect(db.prepare("SELECT * FROM prs").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM pr_checks").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM pr_comments").all()).toEqual([]);
    expect(retireReviewPr).toHaveBeenCalledWith("pba-webapp", 42);
  });
});
