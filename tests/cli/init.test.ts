import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit, type InitInteractiveAnswers } from "../../src/cli/init.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ct-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runInit - step 1: create local config + profile from examples", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/profile/profile.json"), JSON.stringify({ schemaVersion: 1, githubLogin: "example", displayName: "Example" }));
    writeFileSync(join(appRoot, "config/examples/profile/policy.json"), JSON.stringify({ schemaVersion: 1, autoAnalyze: { explicitReviewRequests: true, priorityTiers: [] }, repositories: {} }));
    writeFileSync(join(appRoot, "config/examples/profile/persona.md"), "# Persona\n");
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1,
      profileDirectory: "~/.control-tower/profile",
      dataDirectory: "~/.control-tower/data",
      workspaceRoots: [],
      repositoryPaths: {},
      cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 },
      publication: { mode: "shadow" },
      daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("creates profile dir from examples when absent", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(result.profileCreated).toBe(true);
    expect(existsSync(join(tmp, "profile/profile.json"))).toBe(true);
  });

  it("does not overwrite existing profile", () => {
    const profileDir = join(tmp, "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.json"), "existing");
    const result = runInit({
      appRoot,
      profileDir,
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(result.profileCreated).toBe(false);
    expect(readFileSync(join(profileDir, "profile.json"), "utf-8")).toBe("existing");
  });

  it("creates data directory when absent", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(result.dataCreated).toBe(true);
    expect(existsSync(join(tmp, "data"))).toBe(true);
  });

  it("creates local config from example when absent", () => {
    const configPath = join(tmp, "config.json");
    const profileDir = join(tmp, "profile");
    const dataDir = join(tmp, "data");
    const result = runInit({
      appRoot,
      profileDir,
      dataDir,
      configPath,
      nonInteractive: true,
    });
    expect(result.configCreated).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.profileDirectory).toBe(profileDir);
    expect(config.dataDirectory).toBe(dataDir);
    expect(config.publication.mode).toBe("shadow");
  });

  it("runs the optional doctor callback and reports doctorRan", () => {
    let doctorCalls = 0;

    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
      runDoctor: () => {
        doctorCalls++;
      },
    });

    expect(doctorCalls).toBe(1);
    expect(result.doctorRan).toBe(true);
  });
});

describe("runInit - step 2: scan workspace roots for child Git repos", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "shadow" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("discovers immediate child git repos in workspace roots", () => {
    const wsRoot = join(tmp, "workspace");
    mkdirSync(join(wsRoot, "repo-a/.git"), { recursive: true });
    mkdirSync(join(wsRoot, "repo-b/.git"), { recursive: true });
    mkdirSync(join(wsRoot, "not-a-repo"), { recursive: true });

    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      workspaceRoots: [wsRoot],
      nonInteractive: true,
    });
    expect(result.discoveredRepos).toContain(join(wsRoot, "repo-a"));
    expect(result.discoveredRepos).toContain(join(wsRoot, "repo-b"));
    expect(result.discoveredRepos).not.toContain(join(wsRoot, "not-a-repo"));
  });
});

describe("runInit - step 3: map remotes to catalog", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/local-config.json"), "{}");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("proposes catalog matches based on remote URL", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
      workspaceRoots: [],
      fakeRepoRemotes: {
        "/repos/assistant": "git@github.example.com:org/assistant.git",
        "/repos/webapp": "git@github.example.com:org/webapp.git",
      },
      catalog: [
        { id: "assistant", github: "org/assistant" },
        { id: "webapp", github: "org/webapp" },
      ],
    });
    expect(result.catalogMatches).toEqual({
      assistant: "/repos/assistant",
      webapp: "/repos/webapp",
    });
  });
});

describe("runInit - step 4: non-interactive confirmation via flags", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/profile/profile.json"), JSON.stringify({ schemaVersion: 1, githubLogin: "test", displayName: "T" }));
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "shadow" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("applies non-interactive answers to config", () => {
    const answers: InitInteractiveAnswers = {
      githubLogin: "shubh-array",
      activeRepos: { assistant: "/repos/assistant" },
      modelRoles: { primaryReview: { modelId: "composer-2.5-fast" } },
      autoAnalyze: false,
    };
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
      answers,
    });
    const config = JSON.parse(readFileSync(join(tmp, "config.json"), "utf-8"));
    expect(config.repositoryPaths).toEqual({ assistant: "/repos/assistant" });
    expect(result.appliedAnswers).toEqual(answers);
  });
});

describe("runInit - step 5: writes only local config + profile", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/profile/profile.json"), JSON.stringify({ schemaVersion: 1, githubLogin: "x", displayName: "X" }));
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "shadow" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("never modifies files inside appRoot (product repos)", () => {
    const orgConfigBefore = "original";
    writeFileSync(join(appRoot, "config/organization.json"), orgConfigBefore);
    runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    expect(readFileSync(join(appRoot, "config/organization.json"), "utf-8")).toBe(orgConfigBefore);
  });
});

describe("runInit - step 7: enforces publication.mode shadow", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    appRoot = makeTmpDir();
    mkdirSync(join(appRoot, "config/examples/profile"), { recursive: true });
    writeFileSync(join(appRoot, "config/examples/local-config.json"), JSON.stringify({
      schemaVersion: 1, profileDirectory: "", dataDirectory: "", workspaceRoots: [],
      repositoryPaths: {}, cursor: { binary: "agent", modelRoles: { primaryReview: { modelId: "m" } }, maxConcurrentAgents: 1 },
      worktrees: { maxMaterialized: 4 }, publication: { mode: "gated" }, daemon: { port: 9120 },
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("overrides publication.mode to shadow regardless of example template", () => {
    const result = runInit({
      appRoot,
      profileDir: join(tmp, "profile"),
      dataDir: join(tmp, "data"),
      configPath: join(tmp, "config.json"),
      nonInteractive: true,
    });
    const config = JSON.parse(readFileSync(join(tmp, "config.json"), "utf-8"));
    expect(config.publication.mode).toBe("shadow");
    expect(result.publicationModeEnforced).toBe(true);
  });
});
