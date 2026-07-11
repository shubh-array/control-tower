import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { buildGhEnv } from "../security/child-env.js";
import { profileSchema, policySchema } from "../config/schemas.js";
import { compileGlobs } from "../paths/compile.js";

export type Severity = "pass" | "warn" | "fail" | "info";

export interface CheckResult {
  ok: boolean;
  name: string;
  message: string;
  severity?: Severity;
  smokeModels?: string[];
}

function parseSemver(raw: string): { major: number; minor: number; patch: number } | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!m) return null;
  return { major: parseInt(m[1]!, 10), minor: parseInt(m[2]!, 10), patch: parseInt(m[3]!, 10) };
}

function parseCursorVersion(raw: string): { dateStr: string; hash: string } | null {
  const m = /^(\d{4}\.\d{2}\.\d{2})-([a-f0-9]+)$/.exec(raw.trim());
  if (!m) return null;
  return { dateStr: m[1]!, hash: m[2]! };
}

export function checkNodeVersion(versionString: string): CheckResult {
  const sv = parseSemver(versionString);
  if (!sv) return { ok: false, name: "Node.js", message: `Cannot parse version: ${versionString}`, severity: "fail" };
  const ok = sv.major >= 22;
  return { ok, name: "Node.js", message: ok ? `${versionString} (>= 22)` : `${versionString} - requires Node 22+`, severity: ok ? "pass" : "fail" };
}

export function checkPnpmVersion(versionString: string): CheckResult {
  const sv = parseSemver(versionString);
  if (!sv) return { ok: false, name: "pnpm", message: `Cannot parse version: ${versionString}`, severity: "fail" };
  const ok = sv.major >= 10;
  return { ok, name: "pnpm", message: ok ? `${versionString} (>= 10)` : `${versionString} - requires pnpm 10+`, severity: ok ? "pass" : "fail" };
}

export function checkGitVersion(versionOutput: string): CheckResult {
  const sv = parseSemver(versionOutput);
  if (!sv) return { ok: false, name: "Git", message: `Cannot parse version: ${versionOutput}`, severity: "fail" };
  const ok = sv.major > 2 || (sv.major === 2 && sv.minor >= 40);
  return { ok, name: "Git", message: ok ? `${sv.major}.${sv.minor}.${sv.patch} (>= 2.40)` : `${sv.major}.${sv.minor}.${sv.patch} - requires Git 2.40+`, severity: ok ? "pass" : "fail" };
}

export function checkToolVersion(
  versionOutput: string,
  spec: { name: string; minMajor: number; minMinor: number },
): CheckResult {
  const sv = parseSemver(versionOutput);
  if (!sv) return { ok: false, name: spec.name, message: `Cannot parse version: ${versionOutput}`, severity: "fail" };
  const ok = sv.major > spec.minMajor || (sv.major === spec.minMajor && sv.minor >= spec.minMinor);
  return {
    ok,
    name: spec.name,
    severity: ok ? "pass" : "fail",
    message: ok
      ? `${sv.major}.${sv.minor}.${sv.patch} (>= ${spec.minMajor}.${spec.minMinor})`
      : `${sv.major}.${sv.minor}.${sv.patch} - requires ${spec.minMajor}.${spec.minMinor}+`,
  };
}

export function checkCursorVersion(actual: string, floor: string): CheckResult {
  const actualParsed = parseCursorVersion(actual);
  const floorParsed = parseCursorVersion(floor);
  if (!actualParsed || !floorParsed) {
    return { ok: false, name: "Cursor CLI", message: `Cannot parse Cursor version: "${actual}"`, severity: "fail" };
  }

  if (actualParsed.dateStr < floorParsed.dateStr) {
    return { ok: false, name: "Cursor CLI", message: `${actual} - below floor ${floor}; upgrade required`, severity: "fail" };
  }
  if (actualParsed.dateStr === floorParsed.dateStr && actualParsed.hash === floorParsed.hash) {
    return { ok: true, name: "Cursor CLI", message: `${actual} - matches floor`, severity: "pass" };
  }
  return { ok: true, name: "Cursor CLI", message: `${actual} - newer than floor ${floor}; smoke test recommended`, severity: "warn" };
}

export function compareGithubLogin(
  apiLogin: string,
  configuredLogin: string,
): CheckResult {
  if (!apiLogin) {
    return { ok: false, name: "GitHub login", message: "API returned empty login", severity: "fail" };
  }
  const normalizedApi = apiLogin.toLowerCase();
  const ok = normalizedApi === configuredLogin;
  return {
    ok,
    name: "GitHub login",
    severity: ok ? "pass" : "fail",
    message: ok
      ? `Authenticated as "${normalizedApi}" - matches configured login`
      : `Authenticated as "${normalizedApi}" but configured login is "${configuredLogin}" - mismatch keeps host unhealthy`,
  };
}

export function checkModelAvailability(
  availableModels: string[],
  roleModels: Record<string, string>,
): CheckResult {
  const modelSet = new Set(availableModels);
  const missing: string[] = [];
  const smokeModels = [...new Set(Object.values(roleModels))];

  for (const [role, modelId] of Object.entries(roleModels)) {
    if (!modelSet.has(modelId)) {
      missing.push(`${role}: ${modelId}`);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      name: "Model availability",
      severity: "fail",
      message: `Missing models for roles: ${missing.join(", ")}`,
      smokeModels,
    };
  }

  return {
    ok: true,
    name: "Model availability",
    severity: "pass",
    message: `All role models available (${smokeModels.length} distinct model(s) need smoke)`,
    smokeModels,
  };
}

export function checkModelRoleRequirements(
  modelRoles: { primaryReview?: { modelId: string }; attention?: { modelId: string } },
  opts: { attentionAdvisorEnabled: boolean },
): CheckResult {
  if (!modelRoles.primaryReview) {
    return { ok: false, name: "Model roles", severity: "fail", message: "primaryReview role is always required" };
  }
  if (opts.attentionAdvisorEnabled && !modelRoles.attention) {
    return { ok: false, name: "Model roles", severity: "fail", message: "attention role required when attentionAdvisor.enabled is true" };
  }
  return { ok: true, name: "Model roles", severity: "pass", message: "Model role requirements satisfied" };
}

export function checkSchemaValidity(
  kind: "profile" | "policy" | "harness-manifest" | "glob-compilation",
  data: unknown,
): CheckResult {
  switch (kind) {
    case "profile": {
      const result = profileSchema.safeParse(data);
      return result.success
        ? { ok: true, name: "Profile schema", severity: "pass", message: "Valid" }
        : { ok: false, name: "Profile schema", severity: "fail", message: `Invalid: ${result.error.issues[0]?.message ?? "unknown"}` };
    }
    case "policy": {
      const result = policySchema.safeParse(data);
      return result.success
        ? { ok: true, name: "Policy schema", severity: "pass", message: "Valid" }
        : { ok: false, name: "Policy schema", severity: "fail", message: `Invalid: ${result.error.issues[0]?.message ?? "unknown"}` };
    }
    case "harness-manifest": {
      const manifest = data as { id?: string; prompt?: string; skills?: string[] };
      if (!manifest.id || !manifest.prompt) {
        return { ok: false, name: "Harness manifest", severity: "fail", message: "Manifest missing required id or prompt" };
      }
      return { ok: true, name: "Harness manifest", severity: "pass", message: `Harness "${manifest.id}" materializable` };
    }
    case "glob-compilation": {
      const { globs } = data as { globs: string[] };
      try {
        compileGlobs(globs);
        return { ok: true, name: "Glob compilation", severity: "pass", message: `All ${globs.length} globs compile` };
      } catch (e: any) {
        return { ok: false, name: "Glob compilation", severity: "fail", message: `Glob compile error: ${e.message}` };
      }
    }
  }
}

export function checkDockerAvailable(available: boolean): CheckResult {
  return {
    ok: true,
    name: "Docker",
    severity: "info",
    message: available ? "Docker available" : "Docker not available (optional - not required)",
  };
}

export interface DoctorDeps {
  execCommand: (cmd: string, args: string[], env?: Record<string, string>) => string;
  checkDiskSpace: (path: string) => number;
  checkPortAvailable: (port: number) => boolean;
}

export interface DoctorConfig {
  githubHost: string;
  configuredLogin: string;
  cursorBinary: string;
  cursorVersionFloor: string;
  dataDirectory: string;
  daemonPort: number;
  repositoryPaths: Record<string, string>;
  repositoryCatalog: Map<string, string>;
  modelRoles: { primaryReview?: { modelId: string }; attention?: { modelId: string } };
  attentionAdvisorEnabled: boolean;
  profilePath: string | null;
  policyPath: string | null;
  harnessManifests: Array<{ id: string; prompt: string; skills?: string[] }>;
  domainGlobs: string[];
}

export async function runDoctor(
  config: DoctorConfig,
  deps: DoctorDeps,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const nodeV = deps.execCommand("node", ["--version"]);
    results.push(checkNodeVersion(nodeV));
  } catch {
    results.push({ ok: false, name: "Node.js", message: "Cannot execute node --version", severity: "fail" });
  }

  try {
    const pnpmV = deps.execCommand("pnpm", ["--version"]);
    results.push(checkPnpmVersion(pnpmV));
  } catch {
    results.push({ ok: false, name: "pnpm", message: "Cannot execute pnpm --version", severity: "fail" });
  }

  try {
    const gitV = deps.execCommand("git", ["--version"]);
    results.push(checkGitVersion(gitV));
  } catch {
    results.push({ ok: false, name: "Git", message: "Cannot execute git --version", severity: "fail" });
  }

  try {
    const ghV = deps.execCommand("gh", ["--version"]);
    results.push(checkToolVersion(ghV, { name: "GitHub CLI", minMajor: 2, minMinor: 70 }));
  } catch {
    results.push({ ok: false, name: "GitHub CLI", message: "Cannot execute gh --version", severity: "fail" });
  }

  try {
    const cursorV = deps.execCommand(config.cursorBinary, ["--version"]);
    results.push(checkCursorVersion(cursorV, config.cursorVersionFloor));
  } catch {
    results.push({ ok: false, name: "Cursor CLI", message: "Cannot execute agent --version", severity: "fail" });
  }

  try {
    const statusOut = deps.execCommand(config.cursorBinary, ["status", "--format", "json"]);
    const status = JSON.parse(statusOut);
    const authed = status.isAuthenticated === true;
    results.push({
      ok: authed,
      name: "Cursor auth",
      severity: authed ? "pass" : "fail",
      message: authed ? "Authenticated" : "Not authenticated - run `agent login`",
    });
  } catch {
    results.push({ ok: false, name: "Cursor auth", message: "Cannot check Cursor auth status", severity: "fail" });
  }

  try {
    const modelsOut = deps.execCommand(config.cursorBinary, ["models", "--format", "json"]);
    const parsed = JSON.parse(modelsOut);
    const available: string[] = parsed.models ?? [];
    const roleModelMap: Record<string, string> = {};
    if (config.modelRoles.primaryReview) roleModelMap.primaryReview = config.modelRoles.primaryReview.modelId;
    if (config.modelRoles.attention) roleModelMap.attention = config.modelRoles.attention.modelId;
    results.push(checkModelAvailability(available, roleModelMap));
  } catch {
    results.push({ ok: false, name: "Model availability", message: "Cannot retrieve agent models", severity: "fail" });
  }

  results.push(checkModelRoleRequirements(config.modelRoles, { attentionAdvisorEnabled: config.attentionAdvisorEnabled }));

  try {
    const ghEnv = buildGhEnv(process.env as Record<string, string>, { host: config.githubHost });
    deps.execCommand("gh", ["auth", "status", "--hostname", config.githubHost], ghEnv);
    results.push({ ok: true, name: "GitHub auth", severity: "pass", message: `Authenticated to ${config.githubHost}` });
  } catch {
    results.push({
      ok: false,
      name: "GitHub auth",
      severity: "fail",
      message: `Not authenticated to ${config.githubHost} - run \`gh auth login --hostname ${config.githubHost}\``,
    });
  }

  try {
    const ghEnv = buildGhEnv(process.env as Record<string, string>, { host: config.githubHost });
    const apiLogin = deps.execCommand(
      "gh",
      ["api", "--hostname", config.githubHost, "user", "--jq", ".login"],
      ghEnv,
    );
    results.push(compareGithubLogin(apiLogin, config.configuredLogin));
  } catch {
    results.push({ ok: false, name: "GitHub login", message: "Cannot retrieve authenticated GitHub login", severity: "fail" });
  }

  for (const [repoId, repoPath] of Object.entries(config.repositoryPaths)) {
    if (!existsSync(repoPath)) {
      results.push({ ok: false, name: `Repo ${repoId}`, message: `Path not found: ${repoPath}`, severity: "fail" });
      continue;
    }
    if (!existsSync(join(repoPath, ".git"))) {
      results.push({ ok: false, name: `Repo ${repoId}`, message: `Not a Git repository: ${repoPath}`, severity: "fail" });
      continue;
    }
    try {
      const origin = deps.execCommand("git", ["-C", repoPath, "remote", "get-url", "origin"]);
      const expected = config.repositoryCatalog.get(repoId);
      if (expected && !origin.includes(expected)) {
        results.push({
          ok: false,
          name: `Repo ${repoId}`,
          severity: "fail",
          message: `Remote origin "${origin}" does not match catalog "${expected}"`,
        });
      } else {
        results.push({ ok: true, name: `Repo ${repoId}`, severity: "pass", message: `${repoPath} - origin matches catalog` });
      }
    } catch {
      results.push({ ok: false, name: `Repo ${repoId}`, message: `Cannot read origin for ${repoPath}`, severity: "fail" });
    }
  }

  if (config.profilePath) {
    try {
      const profileData = JSON.parse(deps.execCommand("cat", [config.profilePath]));
      results.push(checkSchemaValidity("profile", profileData));
    } catch {
      results.push({ ok: false, name: "Profile schema", message: "Cannot read/parse profile", severity: "fail" });
    }
  }
  if (config.policyPath) {
    try {
      const policyData = JSON.parse(deps.execCommand("cat", [config.policyPath]));
      results.push(checkSchemaValidity("policy", policyData));
    } catch {
      results.push({ ok: false, name: "Policy schema", message: "Cannot read/parse policy", severity: "fail" });
    }
  }
  for (const manifest of config.harnessManifests) {
    results.push(checkSchemaValidity("harness-manifest", manifest));
  }
  if (config.domainGlobs.length > 0) {
    results.push(checkSchemaValidity("glob-compilation", { globs: config.domainGlobs }));
  }

  try {
    if (!existsSync(config.dataDirectory)) {
      results.push({ ok: false, name: "Data directory", message: `Not found: ${config.dataDirectory}`, severity: "fail" });
    } else {
      accessSync(config.dataDirectory, constants.W_OK);
      const freeBytes = deps.checkDiskSpace(config.dataDirectory);
      const minBytes = 10 * 1024 * 1024 * 1024;
      const ok = freeBytes >= minBytes;
      results.push({
        ok,
        name: "Data directory",
        severity: ok ? "pass" : "fail",
        message: ok
          ? `${config.dataDirectory} - ${(freeBytes / 1024 / 1024 / 1024).toFixed(1)} GB free`
          : `${config.dataDirectory} - only ${(freeBytes / 1024 / 1024 / 1024).toFixed(1)} GB free, need 10 GB`,
      });
    }
  } catch {
    results.push({ ok: false, name: "Data directory", message: `Not writable: ${config.dataDirectory}`, severity: "fail" });
  }

  const portOk = deps.checkPortAvailable(config.daemonPort);
  results.push({
    ok: portOk,
    name: "Daemon port",
    severity: portOk ? "pass" : "fail",
    message: portOk ? `Port ${config.daemonPort} available` : `Port ${config.daemonPort} in use`,
  });

  let dockerAvailable = false;
  try {
    deps.execCommand("docker", ["info"]);
    dockerAvailable = true;
  } catch {
    // Docker not available - not an error
  }
  results.push(checkDockerAvailable(dockerAvailable));

  return results;
}
