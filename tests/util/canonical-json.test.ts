import { describe, it, expect } from "vitest";
import { canonicalJsonSerialize } from "../../src/util/canonical-json.js";

describe("canonicalJsonSerialize", () => {
  it("sorts object keys stably at top level", () => {
    const obj = { zebra: 1, alpha: 2, beta: 3 };
    expect(canonicalJsonSerialize(obj)).toBe('{"alpha":2,"beta":3,"zebra":1}');
  });

  it("sorts nested object keys via replacer", () => {
    const obj = { outer: { z: 1, a: 2 } };
    expect(canonicalJsonSerialize(obj)).toBe('{"outer":{"a":2,"z":1}}');
  });

  it("produces same serialized string regardless of key insertion order", () => {
    const objA = { beta: 2, alpha: 1 };
    const objB = { alpha: 1, beta: 2 };
    expect(canonicalJsonSerialize(objA)).toBe(canonicalJsonSerialize(objB));
  });

  it("preserves array order (does not sort)", () => {
    const obj = { items: [3, 1, 2] };
    expect(canonicalJsonSerialize(obj)).toBe('{"items":[3,1,2]}');
  });
});
