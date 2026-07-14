import { describe, it, expect } from "vitest";
import {
  DEFAULT_PAGE,
  PRIMARY_NAV,
} from "../../client/src/lib/navigation.js";

describe("navigation", () => {
  it("defaults to inbox", () => {
    expect(DEFAULT_PAGE).toBe("inbox");
  });

  it("exposes inbox-only primary nav", () => {
    expect(PRIMARY_NAV.map((item) => item.id)).toEqual(["inbox"]);
    expect(PRIMARY_NAV.map((item) => item.id)).not.toContain("review");
    expect(PRIMARY_NAV.map((item) => item.id)).not.toContain("coverage");
    expect(PRIMARY_NAV.map((item) => item.id)).not.toContain("propose");
  });
});
