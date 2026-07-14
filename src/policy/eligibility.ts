import { normalizeLogin } from "../config/author-login.js";
import { pathMatchesAny } from "../paths/match-patterns.js";
import type { EligibilityReason, ExclusionReason } from "./reasons.js";

export interface EligibilityInput {
  isDraft: boolean;
  explicitRequest: boolean;
  activeRepository: boolean;
  repositoryId: string | null;
  githubOwnerRepo: string;
  changedFiles: string[];
  authorLogin: string;
  eligiblePaths: string[];
  eligibleAuthors: string[];
  operatorLogin: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  exclusions: ExclusionReason[];
  authorOnly: boolean;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const exclusions: ExclusionReason[] = [];

  if (input.isDraft) {
    exclusions.push({ code: "is_draft" });
    return { eligible: false, reasons, exclusions, authorOnly: false };
  }

  if (input.explicitRequest) {
    reasons.push({
      code: "explicit_review_request",
      requestedLogin: normalizeLogin(input.operatorLogin),
    });
    return { eligible: true, reasons, exclusions, authorOnly: false };
  }

  if (!input.activeRepository) {
    exclusions.push(
      input.repositoryId
        ? {
            code: "inactive_repository",
            repositoryId: input.repositoryId,
            githubOwnerRepo: input.githubOwnerRepo,
          }
        : {
            code: "inactive_repository",
            githubOwnerRepo: input.githubOwnerRepo,
          },
    );
    return { eligible: false, reasons, exclusions, authorOnly: false };
  }

  const repositoryId = requireRepositoryId(input.repositoryId);

  for (const changedFile of input.changedFiles) {
    if (!pathMatchesAny(changedFile, input.eligiblePaths)) {
      continue;
    }

    const matchedRule =
      input.eligiblePaths.find((pattern) => pathMatchesAny(changedFile, [pattern])) ??
      input.eligiblePaths[0];

    if (!matchedRule) {
      continue;
    }

    reasons.push({
      code: "eligible_path",
      repositoryId,
      matchedPath: changedFile,
      matchedRule,
    });
  }

  const normalizedAuthor = normalizeLogin(input.authorLogin);
  const authorMatch = input.eligibleAuthors
    .map((login) => normalizeLogin(login))
    .includes(normalizedAuthor);

  if (authorMatch) {
    reasons.push({
      code: "eligible_author",
      repositoryId,
      normalizedLogin: normalizedAuthor,
    });
  }

  if (reasons.length === 0) {
    exclusions.push({
      code: "no_eligible_path_or_author_match",
      repositoryId,
    });
    return { eligible: false, reasons, exclusions, authorOnly: false };
  }

  const hasPathReason = reasons.some((reason) => reason.code === "eligible_path");
  const hasExplicitReason = reasons.some(
    (reason) => reason.code === "explicit_review_request",
  );

  return {
    eligible: true,
    reasons,
    exclusions,
    authorOnly: !hasPathReason && !hasExplicitReason && authorMatch,
  };
}

function requireRepositoryId(repositoryId: string | null): string {
  if (!repositoryId) {
    throw new Error("Active repository eligibility requires a repositoryId");
  }

  return repositoryId;
}
