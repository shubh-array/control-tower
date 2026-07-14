import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "../../src/policy/eligibility.js";
import type {
  EligibilityReason,
  ExclusionReason,
} from "../../src/policy/reasons.js";

interface TruthTableRow {
  name: string;
  input: {
    isDraft: boolean;
    explicitRequest: boolean;
    activeRepo: boolean;
    registeredRepoId: string | null;
    changedFiles: string[];
    authorLogin: string;
    eligiblePaths: string[];
    eligibleAuthors: string[];
    operatorLogin: string;
    githubOwnerRepo: string;
  };
  expected: {
    eligible: boolean;
    reasons?: Array<Partial<EligibilityReason>>;
    exclusions?: Array<Partial<ExclusionReason>>;
  };
}

const truthTable: TruthTableRow[] = [
  {
    name: "explicit request in active repo",
    input: {
      isDraft: false,
      explicitRequest: true,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: [],
      authorLogin: "alice",
      eligiblePaths: [],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: true,
      reasons: [{ code: "explicit_review_request" }],
    },
  },
  {
    name: "explicit request in inactive repo",
    input: {
      isDraft: false,
      explicitRequest: true,
      activeRepo: false,
      registeredRepoId: "pba-webapp",
      changedFiles: [],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: true,
      reasons: [{ code: "explicit_review_request" }],
    },
  },
  {
    name: "explicit request in unregistered repo",
    input: {
      isDraft: false,
      explicitRequest: true,
      activeRepo: false,
      registeredRepoId: null,
      changedFiles: [],
      authorLogin: "alice",
      eligiblePaths: [],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/unknown-repo",
    },
    expected: {
      eligible: true,
      reasons: [{ code: "explicit_review_request" }],
    },
  },
  {
    name: "active repo, path match only",
    input: {
      isDraft: false,
      explicitRequest: false,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["src/components/Button.tsx"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: true,
      reasons: [
        {
          code: "eligible_path",
          matchedPath: "src/components/Button.tsx",
          matchedRule: "src/**",
        },
      ],
    },
  },
  {
    name: "active repo, author match only",
    input: {
      isDraft: false,
      explicitRequest: false,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["README.md"],
      authorLogin: "shubh-array",
      eligiblePaths: ["src/**"],
      eligibleAuthors: ["shubh-array"],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: true,
      reasons: [
        {
          code: "eligible_author",
          normalizedLogin: "shubh-array",
        },
      ],
    },
  },
  {
    name: "active repo, path AND author match (both recorded)",
    input: {
      isDraft: false,
      explicitRequest: false,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["src/app.ts"],
      authorLogin: "shubh-array",
      eligiblePaths: ["src/**"],
      eligibleAuthors: ["shubh-array"],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: true,
      reasons: [{ code: "eligible_path" }, { code: "eligible_author" }],
    },
  },
  {
    name: "active repo, neither path nor author match",
    input: {
      isDraft: false,
      explicitRequest: false,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["docs/readme.md"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: ["shubh-array"],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: false,
      exclusions: [{ code: "no_eligible_path_or_author_match" }],
    },
  },
  {
    name: "inactive repo with path match - still ineligible",
    input: {
      isDraft: false,
      explicitRequest: false,
      activeRepo: false,
      registeredRepoId: "pba-webapp",
      changedFiles: ["src/app.ts"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: false,
      exclusions: [{ code: "inactive_repository" }],
    },
  },
  {
    name: "inactive repo with author match - still ineligible",
    input: {
      isDraft: false,
      explicitRequest: false,
      activeRepo: false,
      registeredRepoId: "pba-webapp",
      changedFiles: [],
      authorLogin: "shubh-array",
      eligiblePaths: [],
      eligibleAuthors: ["shubh-array"],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: false,
      exclusions: [{ code: "inactive_repository" }],
    },
  },
  {
    name: "draft PR with explicit request is ineligible",
    input: {
      isDraft: true,
      explicitRequest: true,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["src/a.ts"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: false,
      exclusions: [{ code: "is_draft" }],
    },
  },
  {
    name: "draft PR with path match is ineligible",
    input: {
      isDraft: true,
      explicitRequest: false,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["src/components/Button.tsx"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
    },
    expected: {
      eligible: false,
      exclusions: [{ code: "is_draft" }],
    },
  },
];

describe("evaluateEligibility", () => {
  truthTable.forEach(({ name, input, expected }) => {
    it(name, () => {
      const result = evaluateEligibility({
        isDraft: input.isDraft,
        explicitRequest: input.explicitRequest,
        activeRepository: input.activeRepo,
        repositoryId: input.registeredRepoId,
        githubOwnerRepo: input.githubOwnerRepo,
        changedFiles: input.changedFiles,
        authorLogin: input.authorLogin,
        eligiblePaths: input.eligiblePaths,
        eligibleAuthors: input.eligibleAuthors,
        operatorLogin: input.operatorLogin,
      });

      expect(result.eligible).toBe(expected.eligible);

      if (expected.reasons) {
        expect(result.reasons).toHaveLength(expected.reasons.length);
        for (const reason of expected.reasons) {
          expect(result.reasons).toEqual(
            expect.arrayContaining([expect.objectContaining(reason)]),
          );
        }
      }

      if (expected.exclusions) {
        expect(result.exclusions).toHaveLength(expected.exclusions.length);
        for (const exclusion of expected.exclusions) {
          expect(result.exclusions).toEqual(
            expect.arrayContaining([expect.objectContaining(exclusion)]),
          );
        }
      }
    });
  });

  it("records multiple path matches across different files", () => {
    const result = evaluateEligibility({
      isDraft: false,
      explicitRequest: false,
      activeRepository: true,
      repositoryId: "pba-webapp",
      githubOwnerRepo: "Org/pba-webapp",
      changedFiles: ["src/a.ts", "src/b.ts"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
    });

    expect(result.eligible).toBe(true);
    const pathReasons = result.reasons.filter((reason) => reason.code === "eligible_path");
    expect(pathReasons).toHaveLength(2);
  });

  it("normalizes author login before author eligibility matching", () => {
    const result = evaluateEligibility({
      isDraft: false,
      explicitRequest: false,
      activeRepository: true,
      repositoryId: "pba-webapp",
      githubOwnerRepo: "Org/pba-webapp",
      changedFiles: ["README.md"],
      authorLogin: "  Shubh-Array  ",
      eligiblePaths: ["src/**"],
      eligibleAuthors: ["shubh-array"],
      operatorLogin: "shubh-array",
    });

    expect(result.eligible).toBe(true);
    expect(result.authorOnly).toBe(true);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "eligible_author",
          normalizedLogin: "shubh-array",
        }),
      ]),
    );
  });
});
