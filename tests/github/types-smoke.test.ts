import { describe, it, expect } from "vitest";
import {
  PRIORITY_SORT_ORDINALS,
  type AnalysisMode,
} from "../../src/github/types.js";

describe("github types smoke", () => {
  it("defines AnalysisMode union without 'none'", () => {
    const modes: AnalysisMode[] = ["auto", "on_demand"];
    expect(modes).toEqual(["auto", "on_demand"]);
    expect(modes).not.toContain("none");
  });

  it("assigns unranked priority sort ordinal 4", () => {
    expect(PRIORITY_SORT_ORDINALS.unranked).toBe(4);
  });
});
