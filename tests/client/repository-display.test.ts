import { describe, expect, it } from "vitest";
import { formatRepositoryPr } from "../../client/src/lib/repository-display.js";

describe("formatRepositoryPr", () => {
  it("preserves the full owner/repository identity with PR number", () => {
    expect(formatRepositoryPr("acme-corp/widgets", 42)).toBe(
      "acme-corp/widgets#42",
    );
  });

  it("keeps distinct repositories from colliding when basenames match", () => {
    expect(formatRepositoryPr("org-a/widgets", 1)).toBe("org-a/widgets#1");
    expect(formatRepositoryPr("org-b/widgets", 1)).toBe("org-b/widgets#1");
    expect(formatRepositoryPr("org-a/widgets", 1)).not.toBe(
      formatRepositoryPr("org-b/widgets", 1),
    );
  });
});
