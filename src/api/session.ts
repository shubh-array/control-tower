import { randomBytes, createHmac } from "node:crypto";

export function createSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

export function createSessionCookie(secret: string): string {
  const signature = createHmac("sha256", secret)
    .update("ct_session")
    .digest("hex");
  return [
    `ct_session=${signature}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
  ].join("; ");
}

export function validateSession(
  secret: string,
  cookieHeader: string | undefined,
  origin?: string,
): boolean {
  if (origin !== undefined) {
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (!cookieHeader) return false;

  const match = cookieHeader.match(/ct_session=([0-9a-f]+)/);
  if (!match) return false;

  const expected = createHmac("sha256", secret)
    .update("ct_session")
    .digest("hex");
  return match[1] === expected;
}
