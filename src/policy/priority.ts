import type { PriorityRule } from "../config/types.js";
import {
  PRIORITY_SORT_ORDINALS,
  type PriorityStatus,
} from "../github/types.js";
import { pathMatchesAny } from "../paths/match-patterns.js";
import type {
  DefaultPriorityReason,
  PriorityReason,
  PriorityRuleReason,
  UnrankedReason,
} from "./reasons.js";

export interface PriorityInput {
  eligible: boolean;
  exclusionCodes: string[];
  changedFiles: string[];
  priorityRules: PriorityRule[];
}

export interface PriorityResult {
  status: PriorityStatus;
  sortOrdinal: number;
  reasons: PriorityReason[];
  allMatchingReasons: PriorityReason[];
  selectedReason: PriorityReason | null;
}

export function evaluatePriority(input: PriorityInput): PriorityResult {
  if (!input.eligible) {
    const reason: UnrankedReason = {
      code: "unranked_ineligible",
      eligibilityExclusionCodes: input.exclusionCodes,
    };

    return {
      status: "unranked",
      sortOrdinal: PRIORITY_SORT_ORDINALS.unranked,
      reasons: [reason],
      allMatchingReasons: [reason],
      selectedReason: null,
    };
  }

  const matchingReasons: PriorityRuleReason[] = [];

  for (const [declarationIndex, rule] of input.priorityRules.entries()) {

    for (const changedFile of input.changedFiles) {
      if (!pathMatchesAny(changedFile, rule.paths)) {
        continue;
      }

      const matchedRule =
        rule.paths.find((pattern) => pathMatchesAny(changedFile, [pattern])) ??
        rule.paths[0];

      if (!matchedRule) {
        continue;
      }

      matchingReasons.push({
        code: "priority_rule",
        tier: rule.tier,
        declarationIndex,
        matchedPath: changedFile,
        matchedRule,
      });
    }
  }

  matchingReasons.sort((left, right) => {
    if (left.matchedPath !== right.matchedPath) {
      return left.matchedPath < right.matchedPath ? -1 : 1;
    }

    return left.declarationIndex - right.declarationIndex;
  });

  if (matchingReasons.length === 0) {
    const reason: DefaultPriorityReason = {
      code: "default_priority",
      tier: "p3",
    };

    return {
      status: "p3",
      sortOrdinal: PRIORITY_SORT_ORDINALS.p3,
      reasons: [reason],
      allMatchingReasons: [reason],
      selectedReason: null,
    };
  }

  let winningTier: PriorityStatus = "p3";
  let winningOrdinal = PRIORITY_SORT_ORDINALS.p3;

  for (const reason of matchingReasons) {
    const ordinal = PRIORITY_SORT_ORDINALS[reason.tier as PriorityStatus];
    if (ordinal < winningOrdinal) {
      winningTier = reason.tier as PriorityStatus;
      winningOrdinal = ordinal;
    }
  }

  const winnersAtTier = matchingReasons
    .filter((reason) => reason.tier === winningTier)
    .sort((left, right) => left.declarationIndex - right.declarationIndex);
  const selectedReason = winnersAtTier[0] ?? null;

  return {
    status: winningTier,
    sortOrdinal: winningOrdinal,
    reasons: selectedReason
      ? [selectedReason, ...matchingReasons.filter((reason) => reason !== selectedReason)]
      : [],
    allMatchingReasons: matchingReasons,
    selectedReason,
  };
}
