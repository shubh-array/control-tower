import { describe, it, expect } from "vitest";
import {
  SAFETY_CONTRACT_HASH,
  SAFETY_CONTRACT_TEXT,
  OUTPUT_CONTRACT_HASH,
} from "../../src/app-safety/contracts.js";

const HEX_64 = /^[0-9a-f]{64}$/;

describe("safety contracts", () => {
  it("has 64-char hex hashes without sha256: prefix", () => {
    expect(SAFETY_CONTRACT_HASH).toMatch(HEX_64);
    expect(OUTPUT_CONTRACT_HASH).toMatch(HEX_64);
    expect(SAFETY_CONTRACT_HASH).not.toMatch(/^sha256:/);
    expect(OUTPUT_CONTRACT_HASH).not.toMatch(/^sha256:/);
  });

  it("includes shell execution restriction in safety contract text", () => {
    expect(SAFETY_CONTRACT_TEXT).toContain("MUST NOT execute");
  });
});
