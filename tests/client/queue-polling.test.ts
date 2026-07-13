import { describe, expect, it } from "vitest";
import type { TrackedQueueRow } from "../../client/src/lib/api.js";
import {
  QUEUE_ACTIVE_POLL_MS,
  QUEUE_IDLE_POLL_MS,
  queueHasActiveJob,
  resolveDraftRefetchInterval,
  resolveQueueRefetchInterval,
} from "../../client/src/lib/queue-polling.js";

function row(overrides: Partial<TrackedQueueRow> = {}): TrackedQueueRow {
  return {
    jobId: null,
    repositoryKey: "repo",
    repository: "org/repo",
    prNumber: 42,
    title: "Fix bug",
    author: "dev",
    headSha: "a".repeat(40),
    eligibilityReasons: [],
    exclusionReasons: [],
    priority: "p1",
    priorityReasons: [],
    queueOrder: {
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestamp: "2026-07-10T12:00:00.000Z",
      normalizedRepositoryIdentity: "repo",
      prNumber: 42,
    },
    domains: [],
    attentionState: "ready_for_analysis",
    jobState: null,
    advisorResult: null,
    discoveredAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("queue polling", () => {
  it("detects active analyzing jobs", () => {
    expect(queueHasActiveJob([row({ jobState: "running_agent" })])).toBe(true);
    expect(queueHasActiveJob([row({ jobState: "draft_ready" })])).toBe(false);
    expect(queueHasActiveJob([row({ jobState: null })])).toBe(false);
  });

  it("treats publishing jobs as active for polling cadence", () => {
    expect(queueHasActiveJob([row({ jobState: "publishing" })])).toBe(true);
  });

  it("uses a short interval while active jobs exist and visible", () => {
    expect(
      resolveQueueRefetchInterval({ isVisible: true, hasActiveJob: true }),
    ).toBe(QUEUE_ACTIVE_POLL_MS);
  });

  it("uses a slower interval when idle and visible", () => {
    expect(
      resolveQueueRefetchInterval({ isVisible: true, hasActiveJob: false }),
    ).toBe(QUEUE_IDLE_POLL_MS);
  });

  it("stops polling when the document is hidden", () => {
    expect(
      resolveQueueRefetchInterval({ isVisible: false, hasActiveJob: true }),
    ).toBe(false);
    expect(
      resolveQueueRefetchInterval({ isVisible: false, hasActiveJob: false }),
    ).toBe(false);
  });

  it("keeps an unavailable Review draft query live", () => {
    expect(
      resolveDraftRefetchInterval({
        isVisible: true,
        hasDraft: false,
      }),
    ).toBe(QUEUE_ACTIVE_POLL_MS);
    expect(
      resolveDraftRefetchInterval({
        isVisible: true,
        hasDraft: true,
      }),
    ).toBe(false);
    expect(
      resolveDraftRefetchInterval({
        isVisible: false,
        hasDraft: false,
      }),
    ).toBe(false);
  });
});
