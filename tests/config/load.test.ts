import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadOrganizationConfig,
  loadProfileConfig,
  loadPolicyConfig,
  loadLocalConfig,
} from "../../src/config/load.js";

describe("loadOrganizationConfig", () => {
  // Task 12 provides config/organization.json
  it("loads valid organization.json", () => {
    const cfg = loadOrganizationConfig(
      join(process.cwd(), "config/organization.json"),
    );
    expect(cfg.schemaVersion).toBe(1);
    expect(cfg.repositories.length).toBeGreaterThan(0);
    expect(cfg.github.host).toBe("github.com");
  });

  it("rejects unknown keys", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ct-test-"));
    const file = join(tmp, "org.json");
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        github: { host: "github.com", organizations: ["test"], pollIntervalSeconds: 300 },
        security: { protectedPaths: [] },
        reviewDefaults: { jobTimeoutSeconds: 1200, retentionDays: 30, maxStorageBytes: 10737418240 },
        repositories: [{ id: "r1", github: "org/repo", defaultBranch: "main", resourceClass: "medium" }],
        unknownField: true,
      }),
    );
    expect(() => loadOrganizationConfig(file)).toThrow();
    rmSync(tmp, { recursive: true });
  });

  it("rejects missing file", () => {
    expect(() => loadOrganizationConfig("/nonexistent.json")).toThrow();
  });
});

describe("loadProfileConfig", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ct-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true }); });

  it("loads valid profile.json", () => {
    const file = join(tmp, "profile.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileId: "test",
      githubLogin: "testuser",
      activeRepositoryIds: ["repo1"],
    }));
    const cfg = loadProfileConfig(file);
    expect(cfg.profileId).toBe("test");
  });

  it("rejects unknown keys in profile", () => {
    const file = join(tmp, "profile.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileId: "test",
      githubLogin: "testuser",
      activeRepositoryIds: [],
      extraField: "nope",
    }));
    expect(() => loadProfileConfig(file)).toThrow();
  });
});

describe("loadPolicyConfig", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ct-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true }); });

  it("loads valid policy.json", () => {
    const file = join(tmp, "policy.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      autoAnalyze: { explicitReviewRequests: true, priorityTiers: [] },
      repositories: {},
    }));
    const cfg = loadPolicyConfig(file);
    expect(cfg.schemaVersion).toBe(1);
  });

  it("rejects domain rules exceeding 3 per repository", () => {
    const file = join(tmp, "policy.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      autoAnalyze: { explicitReviewRequests: true, priorityTiers: [] },
      repositories: {
        "repo1": {
          eligiblePaths: [],
          eligibleAuthors: [],
          domainRules: [
            { domain: "a", paths: ["src/**"], priority: 100 },
            { domain: "b", paths: ["lib/**"], priority: 100 },
            { domain: "c", paths: ["test/**"], priority: 100 },
            { domain: "d", paths: ["docs/**"], priority: 100 },
          ],
          priorityRules: [],
        },
      },
    }));
    expect(() => loadPolicyConfig(file)).toThrow();
  });
});

describe("loadLocalConfig", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "ct-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true }); });

  it("loads valid local config", () => {
    const file = join(tmp, "config.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileDirectory: "/tmp/profile",
      dataDirectory: "/tmp/data",
      workspaceRoots: ["/tmp/workspace"],
      repositoryPaths: {},
      cursor: {
        binary: "agent",
        modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } },
        maxConcurrentAgents: 1,
      },
      worktrees: { maxMaterialized: 4 },
      publication: { mode: "shadow" },
    }));
    const cfg = loadLocalConfig(file);
    expect(cfg.cursor.binary).toBe("agent");
    expect(cfg.daemon.port).toBe(9120);
  });

  it("rejects maxConcurrentAgents > 2", () => {
    const file = join(tmp, "config.json");
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      profileDirectory: "/tmp/profile",
      dataDirectory: "/tmp/data",
      workspaceRoots: [],
      repositoryPaths: {},
      cursor: {
        binary: "agent",
        modelRoles: { primaryReview: { modelId: "m" } },
        maxConcurrentAgents: 5,
      },
      worktrees: { maxMaterialized: 4 },
      publication: { mode: "shadow" },
    }));
    expect(() => loadLocalConfig(file)).toThrow();
  });
});
