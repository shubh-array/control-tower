import { describe, expect, it } from "vitest";
import {
  compareQueueOrder,
  computeQueueTimestampSort,
  toQueueTuple,
  type QueueSortInput,
} from "../../src/policy/queue-order.js";

function makeItem(overrides: Partial<QueueSortInput>): QueueSortInput {
  return {
    prNumber: 1,
    normalizedRepositoryIdentity: "pba-webapp",
    prioritySortOrdinal: 3,
    explicitRequest: false,
    explicitRequestTimestamp: undefined,
    updatedAt: "2026-07-09T10:00:00Z",
    eligible: true,
    ...overrides,
  };
}

describe("compareQueueOrder", () => {
  it("sorts p0 before p1 before p2 before p3 before unranked", () => {
    const items: QueueSortInput[] = [
      makeItem({ prioritySortOrdinal: 4, prNumber: 5, eligible: false }),
      makeItem({ prioritySortOrdinal: 3, prNumber: 4 }),
      makeItem({ prioritySortOrdinal: 1, prNumber: 2 }),
      makeItem({ prioritySortOrdinal: 0, prNumber: 1 }),
      makeItem({ prioritySortOrdinal: 2, prNumber: 3 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted.map((item) => item.prioritySortOrdinal)).toEqual([0, 1, 2, 3, 4]);
  });

  it("sorts explicit requests before non-explicit within same priority", () => {
    const items: QueueSortInput[] = [
      makeItem({ explicitRequest: false, prNumber: 2 }),
      makeItem({ explicitRequest: true, prNumber: 1 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0]?.explicitRequest).toBe(true);
  });

  it("sorts by queue timestamp within same priority and explicit status", () => {
    const items: QueueSortInput[] = [
      makeItem({ updatedAt: "2026-07-09T12:00:00Z", prNumber: 2 }),
      makeItem({ updatedAt: "2026-07-09T08:00:00Z", prNumber: 1 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0]?.prNumber).toBe(1);
  });

  it("uses explicit request timestamp as queue timestamp when present", () => {
    const items: QueueSortInput[] = [
      makeItem({
        explicitRequest: true,
        explicitRequestTimestamp: "2026-07-09T15:00:00Z",
        updatedAt: "2026-07-09T20:00:00Z",
        prNumber: 2,
      }),
      makeItem({
        explicitRequest: true,
        explicitRequestTimestamp: "2026-07-09T10:00:00Z",
        updatedAt: "2026-07-09T08:00:00Z",
        prNumber: 1,
      }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0]?.prNumber).toBe(1);
  });

  it("sorts unknown timestamps after all valid instants", () => {
    const items: QueueSortInput[] = [
      makeItem({ updatedAt: "invalid-date", prNumber: 2 }),
      makeItem({ updatedAt: "2026-07-09T12:00:00Z", prNumber: 1 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0]?.prNumber).toBe(1);
    expect(sorted[1]?.prNumber).toBe(2);
  });

  it("breaks timestamp ties with repository identity then PR number", () => {
    const items: QueueSortInput[] = [
      makeItem({ normalizedRepositoryIdentity: "pba-webapp", prNumber: 10 }),
      makeItem({ normalizedRepositoryIdentity: "pba-agents", prNumber: 5 }),
      makeItem({ normalizedRepositoryIdentity: "pba-agents", prNumber: 3 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted.map((item) => `${item.normalizedRepositoryIdentity}#${item.prNumber}`)).toEqual([
      "pba-agents#3",
      "pba-agents#5",
      "pba-webapp#10",
    ]);
  });

  it("complete tuple produces stable sort across all tiers", () => {
    const items: QueueSortInput[] = [
      makeItem({
        prioritySortOrdinal: 3,
        explicitRequest: false,
        updatedAt: "2026-07-09T10:00:00Z",
        normalizedRepositoryIdentity: "pba-webapp",
        prNumber: 42,
      }),
      makeItem({
        prioritySortOrdinal: 0,
        explicitRequest: true,
        explicitRequestTimestamp: "2026-07-08T08:00:00Z",
        updatedAt: "2026-07-09T10:00:00Z",
        normalizedRepositoryIdentity: "pba-agents",
        prNumber: 10,
      }),
      makeItem({
        prioritySortOrdinal: 1,
        explicitRequest: false,
        updatedAt: "2026-07-09T09:00:00Z",
        normalizedRepositoryIdentity: "pba-webapp",
        prNumber: 30,
      }),
      makeItem({
        prioritySortOrdinal: 4,
        explicitRequest: false,
        updatedAt: "2026-07-09T08:00:00Z",
        normalizedRepositoryIdentity: "pba-infra",
        prNumber: 5,
        eligible: false,
      }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted.map((item) => item.prNumber)).toEqual([10, 30, 42, 5]);
  });
});

describe("computeQueueTimestampSort", () => {
  it("uses explicitRequestTimestamp when present", () => {
    const timestamp = computeQueueTimestampSort(
      "2026-07-09T10:00:00Z",
      "2026-07-09T20:00:00Z",
    );
    expect(timestamp).toBe("2026-07-09T10:00:00.000Z");
  });

  it("uses updatedAt when no explicit request", () => {
    const timestamp = computeQueueTimestampSort(
      undefined,
      "2026-07-09T12:00:00Z",
    );
    expect(timestamp).toBe("2026-07-09T12:00:00.000Z");
  });

  it("returns unknown for invalid dates", () => {
    const timestamp = computeQueueTimestampSort(undefined, "not-a-date");
    expect(timestamp).toBe("unknown");
  });
});

describe("toQueueTuple", () => {
  it("maps QueueSortInput to canonical QueueTuple fields", () => {
    const tuple = toQueueTuple(
      makeItem({
        prioritySortOrdinal: 1,
        explicitRequest: true,
        explicitRequestTimestamp: "2026-07-09T10:00:00Z",
        updatedAt: "2026-07-09T20:00:00Z",
        normalizedRepositoryIdentity: "pba-agents",
        prNumber: 7,
      }),
    );

    expect(tuple).toEqual({
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestampSort: "2026-07-09T10:00:00.000Z",
      normalizedRepositoryIdentity: "pba-agents",
      prNumber: 7,
    });
  });
});
