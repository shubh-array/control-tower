import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ActionTokenStore } from "../../src/api/action-token.js";

describe("ActionTokenStore", () => {
  let store: ActionTokenStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ActionTokenStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a token that is a non-empty hex string", () => {
    const token = store.create();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("consume returns true for a valid unused token", () => {
    const token = store.create();
    expect(store.consume(token)).toBe(true);
  });

  it("consume returns false for an already-consumed token", () => {
    const token = store.create();
    store.consume(token);
    expect(store.consume(token)).toBe(false);
  });

  it("consume returns false for an unknown token", () => {
    expect(store.consume("deadbeef".repeat(8))).toBe(false);
  });

  it("consume returns false after 60-second TTL", () => {
    const token = store.create();
    vi.advanceTimersByTime(60_001);
    expect(store.consume(token)).toBe(false);
  });

  it("consume succeeds just before TTL expires", () => {
    const token = store.create();
    vi.advanceTimersByTime(59_999);
    expect(store.consume(token)).toBe(true);
  });

  it("cleanup removes expired tokens", () => {
    store.create();
    store.create();
    vi.advanceTimersByTime(61_000);
    store.cleanup();
    const fresh = store.create();
    expect(store.consume(fresh)).toBe(true);
  });
});
