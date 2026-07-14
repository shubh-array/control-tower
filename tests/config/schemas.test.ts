import { describe, it, expect } from "vitest";
import {
  organizationSchema,
  localConfigSchema,
  policySchema,
} from "../../src/config/schemas.js";

describe("organizationSchema", () => {
  it("rejects unknown keys (strict)", () => {
    const minimalValid = {
      schemaVersion: 1 as const,
      github: {
        host: "github.com",
        organizations: ["acme"],
        pollIntervalSeconds: 60,
      },
      security: {
        protectedPaths: [],
      },
      reviewDefaults: {
        jobTimeoutSeconds: 3600,
        retentionDays: 30,
        maxStorageBytes: 1_073_741_824,
      },
      repositories: [
        {
          id: "repo1",
          github: "acme/repo",
          defaultBranch: "main",
          resourceClass: "medium" as const,
        },
      ],
    };

    const result = organizationSchema.safeParse({
      ...minimalValid,
      unknownKey: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("localConfigSchema", () => {
  it("defaults daemon.port to 9120 when daemon is omitted", () => {
    const minimalValidWithoutDaemon = {
      schemaVersion: 1 as const,
      profileDirectory: "/profiles",
      dataDirectory: "/data",
      workspaceRoots: ["/workspace"],
      repositoryPaths: {},
      cursor: {
        binary: "cursor",
        modelRoles: {
          primaryReview: { modelId: "model-1" },
        },
        maxConcurrentAgents: 1,
      },
      worktrees: {
        maxMaterialized: 3,
      },
      publication: {
        mode: "shadow" as const,
      },
    };

    const parsed = localConfigSchema.parse(minimalValidWithoutDaemon);

    expect(parsed.daemon.port).toBe(9120);
  });
});

describe("policySchema", () => {
  it("accepts valid minimal policy", () => {
    const minimalValid = {
      schemaVersion: 1 as const,
      autoAnalyze: {
        explicitReviewRequests: true,
        priorityTiers: ["p0" as const],
      },
      repositories: {
        repo1: {
          eligiblePaths: [],
          eligibleAuthors: [],
          domainRules: [],
          priorityRules: [],
        },
      },
    };

    const result = policySchema.safeParse(minimalValid);

    expect(result.success).toBe(true);
  });
});
