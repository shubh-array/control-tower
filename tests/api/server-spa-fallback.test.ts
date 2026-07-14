import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiServer, type ServerDeps } from "../../src/api/server.js";
import { EMPTY_INBOX_SUMMARY } from "../../src/api/projections/inbox-summary.js";

const LOOPBACK_HOST = "127.0.0.1:9120";

function createTestDist(): string {
  const distPath = mkdtempSync(join(tmpdir(), "ct-client-dist-"));
  writeFileSync(
    join(distPath, "index.html"),
    "<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>",
    "utf-8",
  );
  mkdirSync(join(distPath, "assets"), { recursive: true });
  writeFileSync(join(distPath, "assets", "app.js"), "console.log('app');", "utf-8");
  return distPath;
}

function createDeps(clientDistPath: string): ServerDeps {
  return {
    getHealthStatus: () => ({ healthy: true, issues: [] }),
    getFocusQueue: () => ({
      now: [],
      next: [],
      monitor: [],
      summary: EMPTY_INBOX_SUMMARY,
    }),
    getJob: () => null,
    getDraft: () => null,
    getAuditTrail: () => [],
    requestAnalyze: () => "job-1",
    requestRetry: () => "job-1",
    getGuardInput: () => null,
    executePublish: async () => ({ status: "completed" }),
    clientDistPath,
  };
}

function loopbackHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Host: LOOPBACK_HOST, ...extra };
}

describe("createApiServer SPA fallback", () => {
  it("serves index.html for direct client routes such as /review/:jobId", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const response = await app.request("/review/job-123", {
      headers: loopbackHeaders(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('id="root"');
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("keeps API routes unauthorized without a session", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const response = await app.request("/api/health", {
      headers: loopbackHeaders(),
    });

    expect(response.status).toBe(401);
  });

  it("keeps authenticated API routes working", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const bootstrap = await app.request("/index.html", {
      headers: loopbackHeaders(),
    });
    const setCookie = bootstrap.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();

    const response = await app.request("/api/health", {
      headers: loopbackHeaders({ Cookie: setCookie!.split(";")[0]! }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ healthy: true, issues: [] });
  });

  it("does not expose removed signal or proposal API routes", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const bootstrap = await app.request("/index.html", {
      headers: loopbackHeaders(),
    });
    const setCookie = bootstrap.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(";")[0]!;

    for (const path of ["/api/signals", "/api/proposals/start"]) {
      const response = await app.request(path, {
        headers: loopbackHeaders({ Cookie: cookie }),
      });
      expect(response.status).toBe(404);
    }
  });

  it("serves built static assets unchanged", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const response = await app.request("/assets/app.js", {
      headers: loopbackHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("console.log('app');");
  });

  it("returns 404 for missing static asset requests", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const response = await app.request("/assets/missing.js", {
      headers: loopbackHeaders(),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for GET /api and unknown /api/* prefixes", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const unauthenticatedApi = await app.request("/api", {
      method: "GET",
      headers: loopbackHeaders(),
    });
    expect(unauthenticatedApi.status).toBe(401);
    expect(await unauthenticatedApi.text()).not.toContain('id="root"');

    const bootstrap = await app.request("/index.html", {
      headers: loopbackHeaders(),
    });
    const setCookie = bootstrap.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(";")[0]!;

    const apiRoot = await app.request("/api", {
      method: "GET",
      headers: loopbackHeaders({ Cookie: cookie }),
    });
    expect(apiRoot.status).toBe(404);
    expect(await apiRoot.text()).not.toContain('id="root"');

    const unknownApi = await app.request("/api/unknown-prefix", {
      method: "GET",
      headers: loopbackHeaders({ Cookie: cookie }),
    });
    expect(unknownApi.status).toBe(404);
    expect(await unknownApi.text()).not.toContain('id="root"');
    expect(unknownApi.headers.get("content-type")).not.toContain("text/html");
  });

  it("returns 404 for removed client routes such as /propose", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const response = await app.request("/propose", {
      headers: loopbackHeaders(),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('id="root"');
    expect(response.headers.get("content-type")).not.toContain("text/html");
  });

  it("serves SPA fallback for HEAD /review/:jobId without a body", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    const response = await app.request("/review/job-123", {
      method: "HEAD",
      headers: loopbackHeaders(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("");
  });

  it("returns 404 for missing file-like asset paths", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    for (const path of ["/missing.html", "/assets/file.mjs"]) {
      const response = await app.request(path, {
        headers: loopbackHeaders(),
      });

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('id="root"');
    }
  });

  it("returns 404 for non-navigation methods on extensionless client paths", async () => {
    const distPath = createTestDist();
    const { app } = createApiServer(createDeps(distPath));

    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
      const response = await app.request("/review/example", {
        method,
        headers: loopbackHeaders(),
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).not.toContain("text/html");
      expect(await response.text()).not.toContain('id="root"');
    }
  });
});
