import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { jobsRoutes } from "../../src/api/routes/jobs.js";
import { ActionTokenStore } from "../../src/api/action-token.js";
import { PrNotEligibleForReviewError } from "../../src/orchestrator/analyze-errors.js";

function createJobsApp(overrides: {
  requestAnalyze?: ReturnType<typeof vi.fn>;
  requestRetry?: ReturnType<typeof vi.fn>;
} = {}) {
  const actionTokens = new ActionTokenStore();
  const app = new Hono();
  app.route(
    "/",
    jobsRoutes({
      actionTokens,
      getJob: () => null,
      requestAnalyze: overrides.requestAnalyze ?? vi.fn(() => "job-new"),
      requestRetry: overrides.requestRetry ?? vi.fn(() => "job-retry"),
    }),
  );
  return { app, actionTokens };
}

function createAnalyzeApp(requestAnalyze: ReturnType<typeof vi.fn>) {
  return createJobsApp({ requestAnalyze });
}

describe("POST /api/jobs/analyze", () => {
  it("rejects Analyze for a missing or ineligible PR without creating a job", async () => {
    const requestAnalyze = vi.fn(() => {
      throw new PrNotEligibleForReviewError();
    });
    const { app, actionTokens } = createAnalyzeApp(requestAnalyze);
    const token = actionTokens.create();

    const response = await app.request("/api/jobs/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryKey: "repo-a",
        prNumber: 9,
        actionToken: token,
      }),
    });

    expect(response.status).toBe(422);
    expect(requestAnalyze).toHaveBeenCalledOnce();
    const body = await response.json() as { error: string };
    expect(body.error).toBe("PR is not eligible for review");
  });

  it("returns job id when analyze succeeds", async () => {
    const requestAnalyze = vi.fn(() => "job-new");
    const { app, actionTokens } = createAnalyzeApp(requestAnalyze);
    const token = actionTokens.create();

    const response = await app.request("/api/jobs/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryKey: "repo-a",
        prNumber: 7,
        actionToken: token,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobId: "job-new" });
  });

  it("returns the same job id for repeated analyze of a current eligible job", async () => {
    const requestAnalyze = vi.fn(() => "job-stable");
    const { app, actionTokens } = createAnalyzeApp(requestAnalyze);
    const firstToken = actionTokens.create();
    const secondToken = actionTokens.create();

    const first = await app.request("/api/jobs/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryKey: "repo-a",
        prNumber: 7,
        actionToken: firstToken,
      }),
    });
    const second = await app.request("/api/jobs/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryKey: "repo-a",
        prNumber: 7,
        actionToken: secondToken,
      }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ jobId: "job-stable" });
    await expect(second.json()).resolves.toEqual({ jobId: "job-stable" });
    expect(requestAnalyze).toHaveBeenCalledTimes(2);
  });

  it("does not pass client-provided sourceMode to requestAnalyze", async () => {
    const requestAnalyze = vi.fn(() => "job-new");
    const { app, actionTokens } = createAnalyzeApp(requestAnalyze);
    const token = actionTokens.create();

    await app.request("/api/jobs/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryKey: "repo-a",
        prNumber: 7,
        sourceMode: "remote-evidence-only",
        actionToken: token,
      }),
    });

    expect(requestAnalyze).toHaveBeenCalledWith({
      repositoryKey: "repo-a",
      prNumber: 7,
    });
  });
});

describe("POST /api/jobs/:id/retry", () => {
  it("returns job id when retry succeeds", async () => {
    const requestRetry = vi.fn(() => "job-fail");
    const { app, actionTokens } = createJobsApp({ requestRetry });
    const token = actionTokens.create();

    const response = await app.request("/api/jobs/job-fail/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionToken: token }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobId: "job-fail" });
    expect(requestRetry).toHaveBeenCalledWith("job-fail");
  });
});
