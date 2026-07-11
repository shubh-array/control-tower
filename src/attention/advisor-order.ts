const RELEVANCE_ORDINAL: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

const RISK_ORDINAL: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

export interface AdvisorOrderItem {
  repositoryKey: string;
  prNumber: number;
  hasCurrentAdvice: boolean;
  relevance: string | null;
  risk: string | null;
  prioritySortOrdinal: number;
  explicitRequestSort: number;
  queueTimestamp: string | null;
  normalizedRepositoryIdentity: string;
}

function deterministicTupleCompare(a: AdvisorOrderItem, b: AdvisorOrderItem): number {
  if (a.prioritySortOrdinal !== b.prioritySortOrdinal)
    return a.prioritySortOrdinal - b.prioritySortOrdinal;
  if (a.explicitRequestSort !== b.explicitRequestSort)
    return a.explicitRequestSort - b.explicitRequestSort;
  const aTs = a.queueTimestamp ?? '\uffff';
  const bTs = b.queueTimestamp ?? '\uffff';
  if (aTs !== bTs) return aTs < bTs ? -1 : 1;
  if (a.normalizedRepositoryIdentity !== b.normalizedRepositoryIdentity)
    return a.normalizedRepositoryIdentity < b.normalizedRepositoryIdentity ? -1 : 1;
  return a.prNumber - b.prNumber;
}

export function computeAdvisorOrder(items: AdvisorOrderItem[]): AdvisorOrderItem[] {
  const advised = items.filter(i => i.hasCurrentAdvice);
  const nonAdvised = items.filter(i => !i.hasCurrentAdvice);

  advised.sort((a, b) => {
    const relA = RELEVANCE_ORDINAL[a.relevance ?? 'unknown'] ?? 4;
    const relB = RELEVANCE_ORDINAL[b.relevance ?? 'unknown'] ?? 4;
    if (relA !== relB) return relA - relB;

    const riskA = RISK_ORDINAL[a.risk ?? 'unknown'] ?? 4;
    const riskB = RISK_ORDINAL[b.risk ?? 'unknown'] ?? 4;
    if (riskA !== riskB) return riskA - riskB;

    return deterministicTupleCompare(a, b);
  });

  nonAdvised.sort(deterministicTupleCompare);

  return [...advised, ...nonAdvised];
}
