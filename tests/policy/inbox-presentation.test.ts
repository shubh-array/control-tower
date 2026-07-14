import { describe, it, expect } from "vitest";
import {
  classifyInboxPipeline,
  isDraftStale,
} from "../../src/policy/inbox-presentation.js";

describe("inbox presentation", () => {
  it("classifies pipeline buckets from job state", () => {
    expect(classifyInboxPipeline(null)).toBe("needs_analysis");
    expect(classifyInboxPipeline("queued")).toBe("analyzing");
    expect(classifyInboxPipeline("running_agent")).toBe("analyzing");
    expect(classifyInboxPipeline("draft_ready")).toBe("ready");
    expect(classifyInboxPipeline("awaiting_approval")).toBe("ready");
    expect(classifyInboxPipeline("publishing")).toBe("ready");
    expect(classifyInboxPipeline("failed")).toBe("failed");
  });

  it("marks reviewable drafts stale when PR head moved", () => {
    expect(
      isDraftStale({
        prHeadSha: "b".repeat(40),
        jobHeadSha: "a".repeat(40),
        jobState: "draft_ready",
      }),
    ).toBe(true);

    expect(
      isDraftStale({
        prHeadSha: "a".repeat(40),
        jobHeadSha: "a".repeat(40),
        jobState: "draft_ready",
      }),
    ).toBe(false);

    expect(
      isDraftStale({
        prHeadSha: "b".repeat(40),
        jobHeadSha: "a".repeat(40),
        jobState: "failed",
      }),
    ).toBe(false);
  });
});
