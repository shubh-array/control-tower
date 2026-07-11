import { describe, it, expect } from "vitest";
import {
  normalizeLogin,
  validateLoginFormat,
} from "../../src/config/author-login.js";

describe("validateLoginFormat", () => {
  it("accepts simple logins", () => {
    expect(validateLoginFormat("shubh-array")).toBe(true);
    expect(validateLoginFormat("user123")).toBe(true);
    expect(validateLoginFormat("a")).toBe(true);
  });

  it("accepts bot logins", () => {
    expect(validateLoginFormat("dependabot[bot]")).toBe(true);
    expect(validateLoginFormat("renovate[bot]")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateLoginFormat("")).toBe(false);
  });

  it("rejects login starting with hyphen", () => {
    expect(validateLoginFormat("-user")).toBe(false);
  });

  it("rejects login ending with hyphen", () => {
    expect(validateLoginFormat("user-")).toBe(false);
  });

  it("rejects login with special characters", () => {
    expect(validateLoginFormat("user@name")).toBe(false);
    expect(validateLoginFormat("user name")).toBe(false);
    expect(validateLoginFormat("user.name")).toBe(false);
  });

  it("rejects login over 100 characters", () => {
    expect(validateLoginFormat("a".repeat(101))).toBe(false);
  });

  it("accepts login of exactly 100 characters", () => {
    expect(validateLoginFormat("a".repeat(100))).toBe(true);
  });
});

describe("normalizeLogin", () => {
  it("trims whitespace", () => {
    expect(normalizeLogin("  shubh-array  ")).toBe("shubh-array");
  });

  it("lowercases", () => {
    expect(normalizeLogin("Shubh-Array")).toBe("shubh-array");
    expect(normalizeLogin("USER")).toBe("user");
  });

  it("trims then lowercases", () => {
    expect(normalizeLogin("  MyUser  ")).toBe("myuser");
  });

  it("throws on invalid format after normalization", () => {
    expect(() => normalizeLogin("")).toThrow();
    expect(() => normalizeLogin("   ")).toThrow();
    expect(() => normalizeLogin("-bad")).toThrow();
    expect(() => normalizeLogin("bad-")).toThrow();
    expect(() => normalizeLogin("user@host")).toThrow();
  });

  it("normalizes bot logins", () => {
    expect(normalizeLogin("Dependabot[bot]")).toBe("dependabot[bot]");
  });
});
