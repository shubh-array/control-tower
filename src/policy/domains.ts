import type { DomainRule } from "../config/types.js";
import { pathMatchesAny } from "../paths/match-patterns.js";
import type { DomainMatchReason, SelectedDomain } from "./reasons.js";

const MAX_DOMAINS = 3;

export interface DomainInput {
  changedFiles: string[];
  domainRules: DomainRule[];
}

export interface DomainResult {
  selected: SelectedDomain[];
  allReasons: DomainMatchReason[];
}

export function selectDomains(input: DomainInput): DomainResult {
  const allReasons: DomainMatchReason[] = [];

  for (const [declarationIndex, rule] of input.domainRules.entries()) {
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

      allReasons.push({
        code: "domain_rule",
        domain: rule.domain,
        numericPriority: rule.priority,
        declarationIndex,
        matchedPath: changedFile,
        matchedRule,
      });
    }
  }

  if (allReasons.length === 0) {
    return { selected: [], allReasons: [] };
  }

  const reasonsByDomain = new Map<string, DomainMatchReason[]>();
  for (const reason of allReasons) {
    const reasons = reasonsByDomain.get(reason.domain) ?? [];
    reasons.push(reason);
    reasonsByDomain.set(reason.domain, reasons);
  }

  const selected: SelectedDomain[] = [];

  for (const [domain, reasons] of reasonsByDomain) {
    reasons.sort((left, right) => {
      if (right.numericPriority !== left.numericPriority) {
        return right.numericPriority - left.numericPriority;
      }

      if (left.declarationIndex !== right.declarationIndex) {
        return left.declarationIndex - right.declarationIndex;
      }

      return left.matchedPath < right.matchedPath ? -1 : left.matchedPath > right.matchedPath ? 1 : 0;
    });

    const winner = reasons[0];
    if (!winner) {
      continue;
    }

    const matchedPaths = reasons
      .filter(
        (reason) =>
          reason.numericPriority === winner.numericPriority &&
          reason.declarationIndex === winner.declarationIndex,
      )
      .map((reason) => reason.matchedPath)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

    selected.push({
      domain,
      selectedPriority: winner.numericPriority,
      selectedDeclarationIndex: winner.declarationIndex,
      matchedPaths,
      allReasons: reasons,
    });
  }

  selected.sort((left, right) => {
    if (right.selectedPriority !== left.selectedPriority) {
      return right.selectedPriority - left.selectedPriority;
    }

    if (left.selectedDeclarationIndex !== right.selectedDeclarationIndex) {
      return left.selectedDeclarationIndex - right.selectedDeclarationIndex;
    }

    return left.domain < right.domain ? -1 : left.domain > right.domain ? 1 : 0;
  });

  return {
    selected: selected.slice(0, MAX_DOMAINS),
    allReasons,
  };
}
