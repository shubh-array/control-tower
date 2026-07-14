import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import {
  type DoctorDeps,
  type DoctorConfig,
  checkNodeVersion,
  checkGitVersion,
  checkPnpmVersion,
  checkToolVersion,
  checkCursorVersion,
  compareGithubLogin,
  checkModelAvailability,
  checkModelRoleRequirements,
  checkSchemaValidity,
  checkDockerAvailable,
  parseAgentModelsOutput,
  runDoctor,
} from "../../src/cli/doctor.js";

describe("checkNodeVersion", () => {
  it("passes for Node 22+", () => {
    const r = checkNodeVersion("v22.0.0");
    expect(r.ok).toBe(true);
  });

  it("passes for Node 25", () => {
    const r = checkNodeVersion("v25.9.0");
    expect(r.ok).toBe(true);
  });

  it("fails for Node 20", () => {
    const r = checkNodeVersion("v20.11.0");
    expect(r.ok).toBe(false);
  });

  it("fails for unparseable version", () => {
    const r = checkNodeVersion("not-a-version");
    expect(r.ok).toBe(false);
  });
});

describe("checkPnpmVersion", () => {
  it("passes for pnpm 10+", () => {
    const r = checkPnpmVersion("10.2.0");
    expect(r.ok).toBe(true);
  });

  it("fails for pnpm 9", () => {
    const r = checkPnpmVersion("9.15.0");
    expect(r.ok).toBe(false);
  });
});

describe("checkGitVersion", () => {
  it("passes for Git 2.40+", () => {
    const r = checkGitVersion("git version 2.50.1");
    expect(r.ok).toBe(true);
  });

  it("fails for Git 2.39", () => {
    const r = checkGitVersion("git version 2.39.0");
    expect(r.ok).toBe(false);
  });
});

describe("checkToolVersion", () => {
  it("extracts and compares semver", () => {
    const r = checkToolVersion("gh version 2.91.0 (2025-01-01)", {
      name: "GitHub CLI",
      minMajor: 2,
      minMinor: 70,
    });
    expect(r.ok).toBe(true);
  });

  it("fails below minimum", () => {
    const r = checkToolVersion("gh version 2.60.0", {
      name: "GitHub CLI",
      minMajor: 2,
      minMinor: 70,
    });
    expect(r.ok).toBe(false);
  });
});

describe("checkCursorVersion", () => {
  const FLOOR = "2026.07.09-a3815c0";

  it("passes for exact floor version", () => {
    const r = checkCursorVersion("2026.07.09-a3815c0", FLOOR);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("pass");
  });

  it("fails for older version", () => {
    const r = checkCursorVersion("2026.06.01-b1234ef", FLOOR);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("fail");
  });

  it("warns for newer version (requires smoke test)", () => {
    const r = checkCursorVersion("2026.08.01-c9999ff", FLOOR);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("warn");
    expect(r.message).toContain("smoke");
  });

  it("fails for unparseable version", () => {
    const r = checkCursorVersion("garbage", FLOOR);
    expect(r.ok).toBe(false);
  });
});

describe("compareGithubLogin", () => {
  it("passes when lowercased API login equals configured login", () => {
    const r = compareGithubLogin("shubh-array", "shubh-array");
    expect(r.ok).toBe(true);
  });

  it("lowercases API login before comparison", () => {
    const r = compareGithubLogin("Shubh-Array", "shubh-array");
    expect(r.ok).toBe(true);
  });

  it("fails on mismatch", () => {
    const r = compareGithubLogin("other-user", "shubh-array");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("other-user");
      expect(r.message).toContain("shubh-array");
    }
  });

  it("fails when API login is empty", () => {
    const r = compareGithubLogin("", "shubh-array");
    expect(r.ok).toBe(false);
  });

  it("lowercases only - no trim or transform", () => {
    const r = compareGithubLogin("SHUBH-ARRAY", "shubh-array");
    expect(r.ok).toBe(true);
  });
});

describe("checkModelAvailability", () => {
  it("passes when all role models are present in agent models output", () => {
    const agentModels = ["composer-2.5-fast", "composer-2.5", "gpt-5.4-high-1m"];
    const roleModels = { primaryReview: "composer-2.5-fast" };
    const r = checkModelAvailability(agentModels, roleModels);
    expect(r.ok).toBe(true);
  });

  it("fails when a role model is missing", () => {
    const agentModels = ["composer-2.5", "gpt-5.4-high-1m"];
    const roleModels = { primaryReview: "composer-2.5-fast", concurrencyReview: "composer-2.5" };
    const r = checkModelAvailability(agentModels, roleModels);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("composer-2.5-fast");
  });

  it("deduplicates smoke checks for same model across roles", () => {
    const agentModels = ["composer-2.5-fast"];
    const roleModels = { primaryReview: "composer-2.5-fast", concurrencyReview: "composer-2.5-fast" };
    const r = checkModelAvailability(agentModels, roleModels);
    expect(r.ok).toBe(true);
    expect(r.smokeModels).toHaveLength(1);
  });
});

describe("parseAgentModelsOutput", () => {
  it("parses JSON models array wrapper", () => {
    expect(
      parseAgentModelsOutput(JSON.stringify({ models: ["composer-2.5", "auto"] })),
    ).toEqual(["composer-2.5", "auto"]);
  });

  it("parses human-readable agent models listing", () => {
    const raw = `Available models

auto - Auto (default)
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast
`;
    expect(parseAgentModelsOutput(raw)).toEqual([
      "auto",
      "composer-2.5",
      "composer-2.5-fast",
    ]);
  });
});

describe("checkModelRoleRequirements", () => {
  it("passes when primaryReview is present", () => {
    const r = checkModelRoleRequirements({
      primaryReview: { modelId: "composer-2.5-fast" },
    });
    expect(r.ok).toBe(true);
  });

  it("fails when primaryReview is missing", () => {
    const r = checkModelRoleRequirements({});
    expect(r.ok).toBe(false);
    expect(r.message).toContain("primaryReview");
  });
});

describe("checkSchemaValidity", () => {
  it("validates profile schema", () => {
    const validProfile = {
      schemaVersion: 1,
      profileId: "test-profile",
      githubLogin: "shubh-array",
      activeRepositoryIds: ["assistant"],
    };
    const r = checkSchemaValidity("profile", validProfile);
    expect(r.ok).toBe(true);
  });

  it("fails on invalid profile schema", () => {
    const r = checkSchemaValidity("profile", { schemaVersion: 999 });
    expect(r.ok).toBe(false);
  });

  it("validates policy schema", () => {
    const validPolicy = {
      schemaVersion: 1,
      autoAnalyze: {
        explicitReviewRequests: true,
        priorityTiers: ["p0"],
      },
      repositories: {},
    };
    const r = checkSchemaValidity("policy", validPolicy);
    expect(r.ok).toBe(true);
  });

  it("validates harness manifest materializability", () => {
    const r = checkSchemaValidity("harness-manifest", {
      id: "pr-review",
      prompt: join(process.cwd(), "config/harnesses/pr-review/prompt.md"),
      skills: [join(process.cwd(), "config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md")],
    });
    expect(r.ok).toBe(true);
  });

  it("fails harness manifests when the prompt file is missing", () => {
    const r = checkSchemaValidity("harness-manifest", {
      id: "pr-review",
      prompt: join(tmpdir(), "definitely-missing-control-tower-prompt.md"),
      skills: [join(process.cwd(), "config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md")],
    });
    expect(r.ok).toBe(false);
  });

  it("fails harness manifests when a skill file is missing", () => {
    const r = checkSchemaValidity("harness-manifest", {
      id: "pr-review",
      prompt: join(process.cwd(), "config/harnesses/pr-review/prompt.md"),
      skills: [join(tmpdir(), "definitely-missing-control-tower-skill.md")],
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Skill not found");
  });

  it("confirms CanonicalPathMatcher compiles all globs without error", () => {
    const r = checkSchemaValidity("glob-compilation", {
      globs: ["src/**/*.ts", "docs/*.md"],
    });
    expect(r.ok).toBe(true);
  });

  it("fails on invalid glob syntax", () => {
    const r = checkSchemaValidity("glob-compilation", {
      globs: ["src/***/invalid"],
    });
    expect(r.ok).toBe(false);
  });
});

describe("checkDockerAvailable", () => {
  it("reports available when docker info succeeds", () => {
    const r = checkDockerAvailable(true);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("info");
  });

  it("reports unavailable but never fails", () => {
    const r = checkDockerAvailable(false);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.message).toContain("not available");
  });
});

describe("runDoctor (integration with fake deps)", () => {
  function makeFakeDeps(overrides: Partial<Record<string, string>> = {}): DoctorDeps {
    const responses: Record<string, string> = {
      "node --version": "v22.5.0",
      "pnpm --version": "10.2.0",
      "git --version": "git version 2.50.1",
      "gh --version": "gh version 2.91.0 (2025-01-01)",
      "agent status --format json": JSON.stringify({ isAuthenticated: true }),
      "agent models": [
        "Available models",
        "",
        "composer-2.5-fast - Composer 2.5 Fast",
        "composer-2.5 - Composer 2.5",
      ].join("\n"),
      "agent models --format json": JSON.stringify({ models: ["composer-2.5-fast", "composer-2.5"] }),
      "gh auth status --hostname github.example.com": "",
      "gh api --hostname github.example.com user --jq .login": "shubh-array",
      "docker info": "Containers: 5",
      "agent --version": "2026.07.09-a3815c0",
      ...overrides,
    };

    return {
      execCommand: (cmd, args, _env) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key in responses) return responses[key]!;
        throw new Error(`Fake runner: unhandled command "${key}"`);
      },
      checkDiskSpace: () => 20 * 1024 * 1024 * 1024,
      checkPortAvailable: () => true,
      smokeModel: (modelId) => ({ ok: true, reportedModelId: modelId }),
    };
  }

  const baseConfig: DoctorConfig = {
    githubHost: "github.example.com",
    configuredLogin: "shubh-array",
    cursorBinary: "agent",
    cursorVersionFloor: "2026.07.09-a3815c0",
    dataDirectory: tmpdir(),
    daemonPort: 9120,
    repositoryPaths: {},
    repositoryCatalog: new Map(),
    modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } },
    profilePath: null,
    policyPath: null,
    harnessManifests: [],
    domainGlobs: [],
  };

  it("all checks pass with valid fake deps", async () => {
    const deps = makeFakeDeps();
    const results = await runDoctor(baseConfig, deps);
    const failures = results.filter((r) => !r.ok);
    expect(failures).toHaveLength(0);
  });

  it("passes model smoke when each distinct configured model echoes back correctly", async () => {
    const deps = makeFakeDeps();
    const results = await runDoctor(baseConfig, deps);
    const smokeResult = results.find((r) => r.name === "Model smoke");
    expect(smokeResult?.ok).toBe(true);
  });

  it("fails when agent is not authenticated", async () => {
    const deps = makeFakeDeps({
      "agent status --format json": JSON.stringify({ isAuthenticated: false }),
    });
    const results = await runDoctor(baseConfig, deps);
    const authResult = results.find((r) => r.name === "Cursor auth");
    expect(authResult?.ok).toBe(false);
  });

  it("fails when GitHub login mismatches", async () => {
    const deps = makeFakeDeps({
      "gh api --hostname github.example.com user --jq .login": "wrong-user",
    });
    const results = await runDoctor(baseConfig, deps);
    const loginResult = results.find((r) => r.name === "GitHub login");
    expect(loginResult?.ok).toBe(false);
  });

  it("fails when Cursor version is below floor", async () => {
    const deps = makeFakeDeps({
      "agent --version": "2026.06.01-b0000aa",
    });
    const results = await runDoctor(baseConfig, deps);
    const cursorResult = results.find((r) => r.name === "Cursor CLI");
    expect(cursorResult?.ok).toBe(false);
  });

  it("warns when Cursor version is newer than floor", async () => {
    const deps = makeFakeDeps({
      "agent --version": "2026.08.15-d9999ff",
    });
    const results = await runDoctor(baseConfig, deps);
    const cursorResult = results.find((r) => r.name === "Cursor CLI");
    expect(cursorResult?.ok).toBe(true);
    expect(cursorResult?.severity).toBe("warn");
  });

  it("docker unavailable reports info but does not fail", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      execCommand: (cmd, args, env) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === "docker info") throw new Error("docker not found");
        return makeFakeDeps().execCommand(cmd, args, env);
      },
    };
    const results = await runDoctor(baseConfig, deps);
    const dockerResult = results.find((r) => r.name === "Docker");
    expect(dockerResult?.ok).toBe(true);
    expect(dockerResult?.severity).toBe("info");
  });

  it("port unavailable fails", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      checkPortAvailable: () => false,
    };
    const results = await runDoctor(baseConfig, deps);
    const portResult = results.find((r) => r.name === "Daemon port");
    expect(portResult?.ok).toBe(false);
  });

  it("awaits async port probes before reporting daemon port status", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      checkPortAvailable: async () => false,
    };
    const results = await runDoctor(baseConfig, deps);
    const portResult = results.find((r) => r.name === "Daemon port");
    expect(portResult?.ok).toBe(false);
  });

  it("disk space below 10GB fails", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      checkDiskSpace: () => 5 * 1024 * 1024 * 1024,
    };
    const results = await runDoctor(baseConfig, deps);
    const diskResult = results.find((r) => r.name === "Data directory");
    expect(diskResult?.ok).toBe(false);
  });

  it("missing model for role fails", async () => {
    const deps = makeFakeDeps({
      "agent models": "Available models\n\ngpt-5.4-high-1m - GPT\n",
      "agent models --format json": JSON.stringify({ models: ["gpt-5.4-high-1m"] }),
    });
    const results = await runDoctor(baseConfig, deps);
    const modelResult = results.find((r) => r.name === "Model availability");
    expect(modelResult?.ok).toBe(false);
  });

  it("fails when model smoke reports a different model id than requested", async () => {
    const deps: DoctorDeps = {
      ...makeFakeDeps(),
      smokeModel: () => ({ ok: true, reportedModelId: "wrong-model" }),
    };
    const results = await runDoctor(baseConfig, deps);
    const smokeResult = results.find((r) => r.name === "Model smoke");
    expect(smokeResult?.ok).toBe(false);
  });

  it("fails when a configured repository path does not exist", async () => {
    const deps = makeFakeDeps();
    const results = await runDoctor(
      {
        ...baseConfig,
        repositoryPaths: { assistant: "/definitely/missing/repo" },
        repositoryCatalog: new Map([["assistant", "org/assistant"]]),
      },
      deps,
    );
    const repoResult = results.find((r) => r.name === "Repo assistant");
    expect(repoResult?.ok).toBe(false);
    expect(repoResult?.message).toContain("Path not found");
  });

  it("runs glob compilation when domainGlobs are populated", async () => {
    const deps = makeFakeDeps();
    const results = await runDoctor(
      { ...baseConfig, domainGlobs: ["src/**/*.ts", "docs/*.md"] },
      deps,
    );
    const globResult = results.find((r) => r.name === "Glob compilation");
    expect(globResult?.ok).toBe(true);
  });

  describe("persona check", () => {
    let tempDir: string;

    afterEach(() => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    it("passes when persona.md exists and is non-empty", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "ct-persona-"));
      const personaPath = join(tempDir, "persona.md");
      writeFileSync(personaPath, "# Review Persona\n");

      const deps = makeFakeDeps();
      const results = await runDoctor({ ...baseConfig, personaPath }, deps);
      const personaResult = results.find((r) => r.name === "Persona");
      expect(personaResult?.ok).toBe(true);
    });

    it("fails when persona.md is empty", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "ct-persona-"));
      const personaPath = join(tempDir, "persona.md");
      writeFileSync(personaPath, "");

      const deps = makeFakeDeps();
      const results = await runDoctor({ ...baseConfig, personaPath }, deps);
      const personaResult = results.find((r) => r.name === "Persona");
      expect(personaResult?.ok).toBe(false);
      expect(personaResult?.message).toContain("empty");
    });
  });
});
