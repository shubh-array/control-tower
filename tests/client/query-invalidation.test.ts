import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../client/src/lib/query-keys.js";
import {
  type InvalidatableQueryClient,
  invalidateAfterAnalyze,
  invalidateAfterApprove,
  invalidateAfterPublish,
  invalidateAfterRetry,
} from "../../client/src/lib/query-invalidation.js";

function createMockClient() {
  const calls: Array<{ queryKey: readonly unknown[] }> = [];
  const client: InvalidatableQueryClient = {
    invalidateQueries: vi.fn(async (opts) => {
      calls.push(opts);
    }),
  };
  return { client, calls };
}

describe("query invalidation mapping", () => {
  it("invalidates queue and health after analyze", async () => {
    const { client, calls } = createMockClient();

    await invalidateAfterAnalyze(client);

    expect(calls).toEqual(
      expect.arrayContaining([
        { queryKey: queryKeys.queue },
        { queryKey: queryKeys.health },
      ]),
    );
  });

  it("invalidates queue, health, and draft after retry", async () => {
    const { client, calls } = createMockClient();

    await invalidateAfterRetry(client, "job-1");

    expect(calls).toEqual(
      expect.arrayContaining([
        { queryKey: queryKeys.queue },
        { queryKey: queryKeys.health },
        { queryKey: queryKeys.draft("job-1") },
      ]),
    );
  });

  it("invalidates queue and draft after approve", async () => {
    const { client, calls } = createMockClient();

    await invalidateAfterApprove(client, "job-2");

    expect(calls).toEqual(
      expect.arrayContaining([
        { queryKey: queryKeys.queue },
        { queryKey: queryKeys.draft("job-2") },
      ]),
    );
  });

  it("invalidates queue and draft after publish", async () => {
    const { client, calls } = createMockClient();

    await invalidateAfterPublish(client, "job-3");

    expect(calls).toEqual(
      expect.arrayContaining([
        { queryKey: queryKeys.queue },
        { queryKey: queryKeys.draft("job-3") },
      ]),
    );
  });
});
