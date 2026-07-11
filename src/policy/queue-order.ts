export interface QueueSortInput {
  prNumber: number;
  normalizedRepositoryIdentity: string;
  prioritySortOrdinal: number;
  explicitRequest: boolean;
  explicitRequestTimestamp?: string;
  updatedAt: string;
  eligible: boolean;
}

export interface QueueTuple {
  prioritySortOrdinal: number;
  explicitRequestSort: 0 | 1;
  queueTimestampSort: string;
  normalizedRepositoryIdentity: string;
  prNumber: number;
}

const UNKNOWN_TIMESTAMP_SENTINEL = "unknown";

export function toQueueTuple(item: QueueSortInput): QueueTuple {
  return {
    prioritySortOrdinal: item.prioritySortOrdinal,
    explicitRequestSort: item.explicitRequest ? 0 : 1,
    queueTimestampSort: computeQueueTimestampSort(
      item.explicitRequestTimestamp,
      item.updatedAt,
    ),
    normalizedRepositoryIdentity: item.normalizedRepositoryIdentity,
    prNumber: item.prNumber,
  };
}

export function computeQueueTimestampSort(
  explicitRequestTimestamp: string | undefined,
  updatedAt: string,
): string {
  const rawTimestamp = explicitRequestTimestamp ?? updatedAt;
  const milliseconds = new Date(rawTimestamp).getTime();

  if (Number.isNaN(milliseconds)) {
    return UNKNOWN_TIMESTAMP_SENTINEL;
  }

  return new Date(milliseconds).toISOString();
}

export function compareQueueOrder(
  left: QueueSortInput,
  right: QueueSortInput,
): number {
  const leftTuple = toQueueTuple(left);
  const rightTuple = toQueueTuple(right);

  if (leftTuple.prioritySortOrdinal !== rightTuple.prioritySortOrdinal) {
    return leftTuple.prioritySortOrdinal - rightTuple.prioritySortOrdinal;
  }

  if (leftTuple.explicitRequestSort !== rightTuple.explicitRequestSort) {
    return leftTuple.explicitRequestSort - rightTuple.explicitRequestSort;
  }

  if (
    leftTuple.queueTimestampSort === UNKNOWN_TIMESTAMP_SENTINEL &&
    rightTuple.queueTimestampSort !== UNKNOWN_TIMESTAMP_SENTINEL
  ) {
    return 1;
  }

  if (
    rightTuple.queueTimestampSort === UNKNOWN_TIMESTAMP_SENTINEL &&
    leftTuple.queueTimestampSort !== UNKNOWN_TIMESTAMP_SENTINEL
  ) {
    return -1;
  }

  if (leftTuple.queueTimestampSort !== rightTuple.queueTimestampSort) {
    return leftTuple.queueTimestampSort < rightTuple.queueTimestampSort ? -1 : 1;
  }

  if (
    leftTuple.normalizedRepositoryIdentity !==
    rightTuple.normalizedRepositoryIdentity
  ) {
    return leftTuple.normalizedRepositoryIdentity <
      rightTuple.normalizedRepositoryIdentity
      ? -1
      : 1;
  }

  return leftTuple.prNumber - rightTuple.prNumber;
}
