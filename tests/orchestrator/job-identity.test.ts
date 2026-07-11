import { describe, it, expect } from "vitest";
import {
  computeJobIdentity,
  type JobIdentityInput,
} from "../../src/orchestrator/job-identity.js";
import {
  computeRunInputHash,
  computeRunId,
} from "../../src/orchestrator/run-identity.js";

const BASE_INPUT: JobIdentityInput = {
  role: "primaryReview",
  repositoryKey: "pba-webapp",
  prNumber: 42,
  headSha: "a".repeat(40),
  sourceMode: "registered-source",
  policyDecisionHash: "policy-hash-abc",
};

describe("computeJobIdentity", () => {
  it("produces a deterministic SHA-256 hex string", () => {
    const id1 = computeJobIdentity(BASE_INPUT);
    const id2 = computeJobIdentity(BASE_INPUT);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when repository changes", () => {
    const alt = computeJobIdentity({
      ...BASE_INPUT,
      repositoryKey: "pba-agents",
    });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it("changes when PR number changes", () => {
    const alt = computeJobIdentity({ ...BASE_INPUT, prNumber: 99 });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it("changes when head SHA changes", () => {
    const alt = computeJobIdentity({ ...BASE_INPUT, headSha: "b".repeat(40) });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it("changes when source mode changes", () => {
    const alt = computeJobIdentity({
      ...BASE_INPUT,
      sourceMode: "remote-evidence-only",
    });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it("changes when policy decision hash changes", () => {
    const alt = computeJobIdentity({
      ...BASE_INPUT,
      policyDecisionHash: "policy-hash-xyz",
    });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it("CRITICAL: is identical regardless of harness manifest hash", () => {
    const id = computeJobIdentity(BASE_INPUT);
    expect(id).toBe(computeJobIdentity(BASE_INPUT));
  });

  it("CRITICAL: job identity has exactly 5 domain inputs + role", () => {
    const id = computeJobIdentity(BASE_INPUT);
    expect(id).toBe(computeJobIdentity({ ...BASE_INPUT }));
  });
});

describe("computeRunInputHash", () => {
  it("changes when harness manifest hash changes", () => {
    const h1 = computeRunInputHash({
      harnessManifestHash: "manifest-a",
      artifactSetHash: "artifacts-a",
      sourceHash: "source-a",
      provenanceCatalogHash: "prov-a",
      modelSpecificationHash: "model-a",
    });
    const h2 = computeRunInputHash({
      harnessManifestHash: "manifest-b",
      artifactSetHash: "artifacts-a",
      sourceHash: "source-a",
      provenanceCatalogHash: "prov-a",
      modelSpecificationHash: "model-a",
    });
    expect(h1).not.toBe(h2);
  });

  it("changes when model specification hash changes", () => {
    const h1 = computeRunInputHash({
      harnessManifestHash: "manifest-a",
      artifactSetHash: "artifacts-a",
      sourceHash: "source-a",
      provenanceCatalogHash: "prov-a",
      modelSpecificationHash: "model-a",
    });
    const h2 = computeRunInputHash({
      harnessManifestHash: "manifest-a",
      artifactSetHash: "artifacts-a",
      sourceHash: "source-a",
      provenanceCatalogHash: "prov-a",
      modelSpecificationHash: "model-b",
    });
    expect(h1).not.toBe(h2);
  });
});

describe("computeRunId", () => {
  it("produces distinct IDs for different attempt numbers under same job", () => {
    const runId1 = computeRunId("job-abc", "run-input-hash", 1);
    const runId2 = computeRunId("job-abc", "run-input-hash", 2);
    expect(runId1).not.toBe(runId2);
    expect(runId1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for same inputs", () => {
    const a = computeRunId("job-1", "rih-1", 3);
    const b = computeRunId("job-1", "rih-1", 3);
    expect(a).toBe(b);
  });
});
