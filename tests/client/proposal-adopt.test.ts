import { describe, expect, it } from "vitest";
import { resolveAdoptControlState } from "../../client/src/lib/proposal-adopt.js";

describe("resolveAdoptControlState", () => {
  it("enables adopt when validation passed and no adoption has run", () => {
    expect(
      resolveAdoptControlState({ isAdopting: false, adoptionResult: null }),
    ).toEqual({ disabled: false, label: "Adopt (single-use)" });
  });

  it("disables adopt while the mutation is pending", () => {
    expect(
      resolveAdoptControlState({ isAdopting: true, adoptionResult: null }),
    ).toEqual({ disabled: true, label: "Adopting…" });
  });

  it("permanently disables adopt after a successful adoption", () => {
    expect(
      resolveAdoptControlState({
        isAdopting: false,
        adoptionResult: { adopted: true, errors: [] },
      }),
    ).toEqual({ disabled: true, label: "Adopt (single-use)" });
  });

  it("allows retry after a failed adoption attempt", () => {
    expect(
      resolveAdoptControlState({
        isAdopting: false,
        adoptionResult: { adopted: false, errors: ["conflict"] },
      }),
    ).toEqual({ disabled: false, label: "Adopt (single-use)" });
  });
});
