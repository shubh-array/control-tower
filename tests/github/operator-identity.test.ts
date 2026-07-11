import { describe, expect, it, vi } from "vitest";
import { verifyOperatorIdentity } from "../../src/github/operator-identity.js";

describe("verifyOperatorIdentity", () => {
  it("returns healthy when authenticated login matches configured login", async () => {
    const execGhText = vi.fn().mockResolvedValue("shubh-array");

    const result = await verifyOperatorIdentity(
      "github.com",
      "shubh-array",
      execGhText,
    );

    expect(result).toEqual({
      host: "github.com",
      healthy: true,
      authenticatedLogin: "shubh-array",
      checkedAt: expect.any(String),
    });
    expect(execGhText).toHaveBeenCalledWith(
      ["api", "--hostname", "github.com", "user", "--jq", ".login"],
      { host: "github.com" },
    );
  });

  it("lowercases authenticated login for comparison", async () => {
    const execGhText = vi.fn().mockResolvedValue("Shubh-Array");

    const result = await verifyOperatorIdentity(
      "github.com",
      "shubh-array",
      execGhText,
    );

    expect(result.healthy).toBe(true);
    expect(result.authenticatedLogin).toBe("shubh-array");
  });

  it("returns unhealthy on login mismatch", async () => {
    const execGhText = vi.fn().mockResolvedValue("other-user");

    const result = await verifyOperatorIdentity(
      "github.com",
      "shubh-array",
      execGhText,
    );

    expect(result.healthy).toBe(false);
    expect(result.authenticatedLogin).toBe("other-user");
    expect(result.error).toMatch(/mismatch/i);
  });

  it("returns unhealthy on gh failure", async () => {
    const execGhText = vi.fn().mockRejectedValue(new Error("gh auth failed"));

    const result = await verifyOperatorIdentity(
      "github.com",
      "shubh-array",
      execGhText,
    );

    expect(result.healthy).toBe(false);
    expect(result.authenticatedLogin).toBeNull();
    expect(result.error).toMatch(/auth failed/i);
  });

  it("never passes @me to gh commands", async () => {
    const execGhText = vi.fn().mockResolvedValue("shubh-array");

    await verifyOperatorIdentity("github.com", "shubh-array", execGhText);

    expect(execGhText).toHaveBeenCalledTimes(1);
    const firstCall = execGhText.mock.calls[0];
    expect(firstCall).toBeDefined();
    const callArgs = firstCall![0] as string[];
    expect(callArgs.join(" ")).not.toContain("@me");
  });
});
