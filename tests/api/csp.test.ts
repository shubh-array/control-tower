import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cspMiddleware, loopbackGuard } from "../../src/api/csp.js";

function makeApp() {
  const app = new Hono();
  app.use("*", loopbackGuard);
  app.use("*", cspMiddleware);
  app.get("/test", (c) => c.text("ok"));
  return app;
}

describe("cspMiddleware", () => {
  it("sets Content-Security-Policy header", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "127.0.0.1:9120" },
    });
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("media-src 'none'");
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "127.0.0.1:9120" },
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("loopbackGuard", () => {
  it("rejects non-loopback host headers", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts 127.0.0.1 host", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "127.0.0.1:9120" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts localhost host", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Host: "localhost:9120" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects cross-origin requests", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: {
        Host: "127.0.0.1:9120",
        Origin: "https://evil.com",
      },
    });
    expect(res.status).toBe(403);
  });
});
