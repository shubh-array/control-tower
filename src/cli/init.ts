import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface InitInteractiveAnswers {
  githubLogin?: string;
  activeRepos?: Record<string, string>;
  modelRoles?: { primaryReview?: { modelId: string } };
  autoAnalyze?: boolean;
}

export interface InitOptions {
  appRoot: string;
  profileDir?: string;
  dataDir?: string;
  configPath?: string;
  workspaceRoots?: string[];
  nonInteractive?: boolean;
  answers?: InitInteractiveAnswers;
  fakeRepoRemotes?: Record<string, string>;
  catalog?: Array<{ id: string; github: string }>;
  runDoctor?: () => void;
}

export interface InitResult {
  profileCreated: boolean;
  dataCreated: boolean;
  configCreated: boolean;
  profileDirectory: string;
  dataDirectory: string;
  discoveredRepos: string[];
  catalogMatches: Record<string, string>;
  appliedAnswers?: InitInteractiveAnswers;
  publicationModeEnforced: boolean;
  doctorRan: boolean;
}

export function runInit(opts: InitOptions): InitResult {
  const defaultBase = join(homedir(), ".control-tower");
  const profileDir = opts.profileDir ?? join(defaultBase, "profile");
  const dataDir = opts.dataDir ?? join(defaultBase, "data");
  const configPath = opts.configPath ?? join(defaultBase, "config.json");

  let profileCreated = false;
  let dataCreated = false;
  let configCreated = false;

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
    const exampleProfileDir = join(opts.appRoot, "config/examples/profile");
    if (existsSync(exampleProfileDir)) {
      cpSync(exampleProfileDir, profileDir, { recursive: true });
    }
    profileCreated = true;
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    dataCreated = true;
  }

  if (!existsSync(configPath)) {
    const exampleConfig = join(opts.appRoot, "config/examples/local-config.json");
    if (existsSync(exampleConfig)) {
      mkdirSync(dirname(configPath), { recursive: true });
      cpSync(exampleConfig, configPath);
    }
    configCreated = true;
  }

  const discoveredRepos: string[] = [];
  const workspaceRoots = opts.workspaceRoots ?? [];
  for (const root of workspaceRoots) {
    if (!existsSync(root)) continue;
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childPath = join(root, entry.name);
      if (existsSync(join(childPath, ".git"))) {
        discoveredRepos.push(childPath);
      }
    }
  }

  const catalogMatches: Record<string, string> = {};
  const catalog = opts.catalog ?? [];
  const repoRemotes = opts.fakeRepoRemotes ?? {};
  for (const [repoPath, remoteUrl] of Object.entries(repoRemotes)) {
    for (const entry of catalog) {
      if (remoteUrl.includes(entry.github)) {
        catalogMatches[entry.id] = repoPath;
      }
    }
  }

  let appliedAnswers: InitInteractiveAnswers | undefined;
  if (opts.nonInteractive && opts.answers) {
    appliedAnswers = opts.answers;
  }

  let publicationModeEnforced = false;
  if (existsSync(configPath)) {
    let config: any;
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }

    if (appliedAnswers?.activeRepos) {
      config.repositoryPaths = appliedAnswers.activeRepos;
    }
    if (appliedAnswers?.modelRoles) {
      config.cursor = config.cursor ?? {};
      config.cursor.modelRoles = appliedAnswers.modelRoles;
    }

    config.profileDirectory = profileDir;
    config.dataDirectory = dataDir;
    config.publication = config.publication ?? {};
    if (config.publication.mode !== "shadow") {
      config.publication.mode = "shadow";
      publicationModeEnforced = true;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  if (appliedAnswers?.githubLogin && existsSync(join(profileDir, "profile.json"))) {
    try {
      const profile = JSON.parse(readFileSync(join(profileDir, "profile.json"), "utf-8"));
      profile.githubLogin = appliedAnswers.githubLogin;
      writeFileSync(join(profileDir, "profile.json"), JSON.stringify(profile, null, 2) + "\n");
    } catch {
      // Profile write is best-effort during init.
    }
  }

  let doctorRan = false;
  if (opts.runDoctor) {
    opts.runDoctor();
    doctorRan = true;
  }

  return {
    profileCreated,
    dataCreated,
    configCreated,
    profileDirectory: profileDir,
    dataDirectory: dataDir,
    discoveredRepos,
    catalogMatches,
    appliedAnswers,
    publicationModeEnforced,
    doctorRan,
  };
}
