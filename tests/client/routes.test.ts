import { describe, expect, it } from "vitest";
import { ROUTES } from "../../client/src/lib/routes.js";

describe("client routes", () => {
  it("defines canonical primary pages", () => {
    expect(ROUTES.inbox).toBe("/inbox");
    expect(ROUTES.coverage).toBe("/coverage");
    expect(ROUTES.propose).toBe("/propose");
  });

  it("builds encoded review deep links", () => {
    expect(ROUTES.review("job/123")).toBe("/review/job%2F123");
  });
});
