import { describe, expect, it } from "vitest";
import { resolveTabKeyAction } from "../../client/src/lib/tabs-keyboard.js";

describe("resolveTabKeyAction", () => {
  const count = 4;

  it("moves focus to the next tab on ArrowRight", () => {
    expect(resolveTabKeyAction("ArrowRight", 1, count)).toEqual({
      type: "focus",
      index: 2,
    });
  });

  it("wraps focus from the last tab to the first on ArrowRight", () => {
    expect(resolveTabKeyAction("ArrowRight", 3, count)).toEqual({
      type: "focus",
      index: 0,
    });
  });

  it("moves focus to the previous tab on ArrowLeft", () => {
    expect(resolveTabKeyAction("ArrowLeft", 2, count)).toEqual({
      type: "focus",
      index: 1,
    });
  });

  it("wraps focus from the first tab to the last on ArrowLeft", () => {
    expect(resolveTabKeyAction("ArrowLeft", 0, count)).toEqual({
      type: "focus",
      index: 3,
    });
  });

  it("moves focus to the first tab on Home", () => {
    expect(resolveTabKeyAction("Home", 2, count)).toEqual({
      type: "focus",
      index: 0,
    });
  });

  it("moves focus to the last tab on End", () => {
    expect(resolveTabKeyAction("End", 1, count)).toEqual({
      type: "focus",
      index: 3,
    });
  });

  it("activates the focused tab on Enter", () => {
    expect(resolveTabKeyAction("Enter", 1, count)).toEqual({
      type: "activate",
    });
  });

  it("activates the focused tab on Space", () => {
    expect(resolveTabKeyAction(" ", 1, count)).toEqual({
      type: "activate",
    });
  });

  it("ignores unrelated keys", () => {
    expect(resolveTabKeyAction("Tab", 1, count)).toBeNull();
  });
});
