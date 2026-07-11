import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex, sha256OfCanonicalJson } from "../../src/util/hash.js";

describe("sha256Hex", () => {
  it("returns lowercase hex only with no sha256: prefix", () => {
    const hash = sha256Hex("hello");
    expect(hash).toBe(createHash("sha256").update("hello").digest("hex"));
    expect(hash).not.toMatch(/^sha256:/);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(64);
  });
});

describe("sha256OfCanonicalJson", () => {
  it("returns stable hash across key order differences", () => {
    const objA = { beta: 2, alpha: 1 };
    const objB = { alpha: 1, beta: 2 };
    expect(sha256OfCanonicalJson(objA)).toBe(sha256OfCanonicalJson(objB));
    expect(sha256OfCanonicalJson(objA).length).toBe(64);
  });
});
