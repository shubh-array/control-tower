import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "../../client/src/lib/query-client.js";

describe("createAppQueryClient", () => {
  it("enables focus refetch and a single retry", () => {
    const client = createAppQueryClient();
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    expect(client.getDefaultOptions().queries?.retry).toBe(1);
  });
});
