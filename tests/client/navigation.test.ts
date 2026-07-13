import { describe, it, expect } from "vitest";
import {
  DEFAULT_PAGE,
  PRIMARY_NAV,
} from "../../client/src/lib/navigation.js";

describe("navigation", () => {
  it("defaults to inbox", () => {
    expect(DEFAULT_PAGE).toBe("inbox");
  });

  it("exposes primary nav without review", () => {
    expect(PRIMARY_NAV.map((item) => item.id)).toEqual([
      "inbox",
      "coverage",
      "propose",
    ]);
    expect(PRIMARY_NAV.map((item) => item.id)).not.toContain("review");
  });
});
