import type { DiscoveredPr } from "../github/types.js";
import type { PolicyDecision } from "../policy/evaluate.js";

export interface PersistedReviewPrIdentity {
  repositoryId: string;
  github: string;
  prNumber: number;
}

export interface ReviewPrRetirement {
  repositoryId: string;
  prNumber: number;
}

export function reviewPrIdentityKey(identity: {
  github: string;
  prNumber: number;
}): string {
  return `${identity.github}#${identity.prNumber}`;
}

function retirementDedupKey(repositoryId: string, prNumber: number): string {
  return `${repositoryId}#${prNumber}`;
}

export function createRetirementCollector(): {
  queue: (repositoryId: string, prNumber: number) => void;
  list: () => ReviewPrRetirement[];
} {
  const candidates = new Map<string, ReviewPrRetirement>();
  return {
    queue(repositoryId: string, prNumber: number): void {
      candidates.set(retirementDedupKey(repositoryId, prNumber), {
        repositoryId,
        prNumber,
      });
    },
    list(): ReviewPrRetirement[] {
      return [...candidates.values()];
    },
  };
}

export interface ReconcileReviewCacheDeps {
  listPersistedReviewPrs: () => Array<PersistedReviewPrIdentity>;
  enrichPr: (ownerRepo: string, prNumber: number) => Promise<unknown | null>;
  normalizePr: (
    raw: unknown,
    repositoryId: string,
    explicitRequest: boolean,
  ) => DiscoveredPr;
  evaluatePolicy: (pr: DiscoveredPr) => PolicyDecision;
  upsertEligiblePr: (pr: DiscoveredPr, decision: PolicyDecision) => number;
  enqueueEligible: (
    prId: number,
    pr: DiscoveredPr,
    decision: PolicyDecision,
  ) => void;
  queueRetirement: (repositoryId: string, prNumber: number) => void;
}

function isTerminalPrState(state: string): boolean {
  return state === "CLOSED" || state === "MERGED";
}

export async function reconcileReviewCache(
  deps: ReconcileReviewCacheDeps,
  currentEligibleKeys: Set<string>,
): Promise<void> {
  for (const row of deps.listPersistedReviewPrs()) {
    const key = reviewPrIdentityKey(row);
    if (currentEligibleKeys.has(key)) {
      continue;
    }

    let enriched: unknown | null;
    enriched = await deps.enrichPr(row.github, row.prNumber);

    if (enriched === null) {
      continue;
    }

    const discovered = deps.normalizePr(enriched, row.repositoryId, false);

    if (isTerminalPrState(discovered.state)) {
      deps.queueRetirement(row.repositoryId, row.prNumber);
      continue;
    }

    if (discovered.state !== "OPEN") {
      continue;
    }

    const decision = deps.evaluatePolicy(discovered);
    if (decision.eligible) {
      const prId = deps.upsertEligiblePr(discovered, decision);
      deps.enqueueEligible(prId, discovered, decision);
      continue;
    }

    deps.queueRetirement(row.repositoryId, row.prNumber);
  }
}
