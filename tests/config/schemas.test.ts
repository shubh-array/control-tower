import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("rejects removed model roles such as attention", () => {
    const result = localConfigSchema.safeParse({
      schemaVersion: 1,
      profileDirectory: "/profiles",
      dataDirectory: "/data",
      workspaceRoots: [],
      repositoryPaths: {},
      cursor: {
        binary: "agent",
        modelRoles: {
          primaryReview: { modelId: "composer-2.5-fast" },
          attention: { modelId: "composer-2.5-fast" },
        },
        maxConcurrentAgents: 1,
      },
      worktrees: { maxMaterialized: 4 },
      publication: { mode: "shadow" },
    });

    expect(result.success).toBe(false);
  });

  it("accepts the committed local-config example", () => {
    const example = JSON.parse(
      readFileSync(
        join(process.cwd(), "config/examples/local-config.json"),
        "utf-8",
      ),
    );

    expect(localConfigSchema.safeParse(example).success).toBe(true);
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
