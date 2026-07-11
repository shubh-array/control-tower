import type { MiddlewareHandler } from "hono";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "worker-src 'none'",
  "media-src 'none'",
].join("; ");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function extractHost(value: string): string {
  return value.replace(/:\d+$/, "");
}

function isLoopback(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  return LOOPBACK_HOSTS.has(extractHost(hostHeader));
}

export const loopbackGuard: MiddlewareHandler = async (c, next) => {
  if (!isLoopback(c.req.header("host"))) {
    return c.text("Forbidden: non-loopback host", 403);
  }

  const origin = c.req.header("origin");
  if (origin) {
    try {
      const url = new URL(origin);
      if (!LOOPBACK_HOSTS.has(url.hostname)) {
        return c.text("Forbidden: cross-origin", 403);
      }
    } catch {
      return c.text("Forbidden: invalid origin", 403);
    }
  }

  await next();
};

export const cspMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("content-security-policy", CSP);
  c.res.headers.set("x-content-type-options", "nosniff");
};
