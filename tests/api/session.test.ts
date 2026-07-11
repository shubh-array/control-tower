import { describe, it, expect, beforeEach } from "vitest";
import {
  createSessionSecret,
  createSessionCookie,
  validateSession,
} from "../../src/api/session.js";

describe("session", () => {
  let secret: string;

  beforeEach(() => {
    secret = createSessionSecret();
  });

  it("creates a 32-byte hex secret", () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates different secrets each time", () => {
    const other = createSessionSecret();
    expect(other).not.toBe(secret);
  });

  it("createSessionCookie returns a Set-Cookie header value", () => {
    const cookie = createSessionCookie(secret);
    expect(cookie).toContain("ct_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });

  it("validateSession succeeds with correct cookie", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1]!.split(";")[0]!;
    expect(validateSession(secret, `ct_session=${tokenValue}`)).toBe(true);
  });

  it("validateSession rejects missing cookie", () => {
    expect(validateSession(secret, undefined)).toBe(false);
  });

  it("validateSession rejects wrong secret", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1]!.split(";")[0]!;
    const other = createSessionSecret();
    expect(validateSession(other, `ct_session=${tokenValue}`)).toBe(false);
  });

  it("validateSession rejects non-loopback origin", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1]!.split(";")[0]!;
    expect(
      validateSession(secret, `ct_session=${tokenValue}`, "https://evil.com"),
    ).toBe(false);
  });

  it("validateSession accepts loopback origin", () => {
    const cookie = createSessionCookie(secret);
    const tokenValue = cookie.split("ct_session=")[1]!.split(";")[0]!;
    expect(
      validateSession(
        secret,
        `ct_session=${tokenValue}`,
        "http://127.0.0.1:9120",
      ),
    ).toBe(true);
  });
});
