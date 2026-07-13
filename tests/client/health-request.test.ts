import { describe, it, expect } from "vitest";
import {
  isLatestHealthRequest,
  resolveHealthBanner,
} from "../../client/src/lib/health-request.js";

describe("isLatestHealthRequest", () => {
  it("accepts only the latest request id", () => {
    expect(isLatestHealthRequest(3, 3)).toBe(true);
    expect(isLatestHealthRequest(2, 3)).toBe(false);
    expect(isLatestHealthRequest(4, 3)).toBe(false);
  });
});

describe("resolveHealthBanner", () => {
  it("shows unavailable only when the health request fails", () => {
    expect(resolveHealthBanner({ kind: "error" })).toBe("unavailable");
  });

  it("does not treat healthy:false as a connection outage", () => {
    expect(
      resolveHealthBanner({
        kind: "ok",
        healthy: false,
        issues: ["9 failed jobs in last 24h"],
      }),
    ).toBe(null);
  });

  it("shows no banner when health is ok", () => {
    expect(resolveHealthBanner({ kind: "ok", healthy: true, issues: [] })).toBe(
      null,
    );
  });
});
