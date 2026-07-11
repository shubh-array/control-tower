import { describe, expect, it } from "vitest";
import { evaluatePriority } from "../../src/policy/priority.js";

describe("evaluatePriority", () => {
  it("defaults to p3 for eligible PR with no matching priority rules", () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ["src/components/Button.tsx"],
      priorityRules: [{ paths: ["src/api-clients/**"], tier: "p1" }],
    });

    expect(result.status).toBe("p3");
    expect(result.sortOrdinal).toBe(3);
    expect(result.reasons).toEqual([{ code: "default_priority", tier: "p3" }]);
  });

  it("selects matched tier from priority rule", () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ["src/api-clients/base.ts"],
      priorityRules: [{ paths: ["src/api-clients/**"], tier: "p1" }],
    });

    expect(result.status).toBe("p1");
    expect(result.sortOrdinal).toBe(1);
    expect(result.selectedReason).toMatchObject({
      code: "priority_rule",
      tier: "p1",
      declarationIndex: 0,
    });
  });

  it("picks winning tier with lowest ordinal across multiple rules", () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ["src/critical/main.ts", "src/api-clients/base.ts"],
      priorityRules: [
        { paths: ["src/api-clients/**"], tier: "p2" },
        { paths: ["src/critical/**"], tier: "p0" },
      ],
    });

    expect(result.status).toBe("p0");
    expect(result.sortOrdinal).toBe(0);
    expect(result.selectedReason).toMatchObject({ tier: "p0" });
  });

  it("picks earliest declaration when same winning tier from multiple rules", () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ["src/api-clients/base.ts", "src/lib/auth/login.ts"],
      priorityRules: [
        { paths: ["src/api-clients/**"], tier: "p1" },
        { paths: ["src/lib/auth/**"], tier: "p1" },
      ],
    });

    expect(result.status).toBe("p1");
    expect(result.selectedReason).toMatchObject({
      declarationIndex: 0,
    });
  });

  it("preserves all matching reasons even for non-winning tiers", () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ["src/critical/main.ts", "src/api-clients/base.ts"],
      priorityRules: [
        { paths: ["src/api-clients/**"], tier: "p2" },
        { paths: ["src/critical/**"], tier: "p0" },
      ],
    });

    expect(result.allMatchingReasons.length).toBeGreaterThanOrEqual(2);
    const tiers = result.allMatchingReasons
      .map((reason) => (reason.code === "priority_rule" ? reason.tier : null))
      .filter(Boolean);
    expect(tiers).toContain("p0");
    expect(tiers).toContain("p2");
  });

  it("assigns unranked with exclusion codes for ineligible PR", () => {
    const result = evaluatePriority({
      eligible: false,
      exclusionCodes: ["inactive_repository"],
      changedFiles: [],
      priorityRules: [],
    });

    expect(result.status).toBe("unranked");
    expect(result.sortOrdinal).toBe(4);
    expect(result.reasons).toEqual([
      {
        code: "unranked_ineligible",
        eligibilityExclusionCodes: ["inactive_repository"],
      },
    ]);
  });

  it("maintains total order: p0 < p1 < p2 < p3 < unranked", () => {
    const ordinals: [number, number, number, number, number] = [
      evaluatePriority({
        eligible: true,
        exclusionCodes: [],
        changedFiles: ["src/p0.ts"],
        priorityRules: [{ paths: ["src/p0.ts"], tier: "p0" }],
      }).sortOrdinal,
      evaluatePriority({
        eligible: true,
        exclusionCodes: [],
        changedFiles: ["src/p1.ts"],
        priorityRules: [{ paths: ["src/p1.ts"], tier: "p1" }],
      }).sortOrdinal,
      evaluatePriority({
        eligible: true,
        exclusionCodes: [],
        changedFiles: ["src/p2.ts"],
        priorityRules: [{ paths: ["src/p2.ts"], tier: "p2" }],
      }).sortOrdinal,
      evaluatePriority({
        eligible: true,
        exclusionCodes: [],
        changedFiles: [],
        priorityRules: [],
      }).sortOrdinal,
      evaluatePriority({
        eligible: false,
        exclusionCodes: ["no_eligible_path_or_author_match"],
        changedFiles: [],
        priorityRules: [],
      }).sortOrdinal,
    ];

    expect(ordinals[1]).toBeGreaterThan(ordinals[0]);
    expect(ordinals[2]).toBeGreaterThan(ordinals[1]);
    expect(ordinals[3]).toBeGreaterThan(ordinals[2]);
    expect(ordinals[4]).toBeGreaterThan(ordinals[3]);
  });

  it("includes matched paths in bytewise ascending order for winning reason", () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ["src/api-clients/z.ts", "src/api-clients/a.ts"],
      priorityRules: [{ paths: ["src/api-clients/**"], tier: "p1" }],
    });

    expect(result.selectedReason).toMatchObject({ code: "priority_rule" });
    const matchedPaths = result.allMatchingReasons
      .filter((reason) => reason.code === "priority_rule")
      .map((reason) => reason.matchedPath);
    const sorted = [...matchedPaths].sort();
    expect(matchedPaths).toEqual(sorted);
  });
});
