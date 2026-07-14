import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import { runDoctor, type DoctorConfig, parseAgentModelsOutput } from "./doctor.js";
import { runInit } from "./init.js";
import { probePortAvailable } from "./port.js";
import { startCommand, stopCommand, statusCommand } from "./daemon-control.js";
import { enablePublication, disablePublication } from "./publication.js";
import { runReset, type ResetScope } from "./reset.js";
import {
  loadLocalConfig,
  loadOrganizationConfig,
  loadProfileConfig,
  loadPolicyConfig,
} from "../config/load.js";
import { normalizeLogin } from "../config/author-login.js";

const appRoot = resolve(join(import.meta.dirname, "../.."));
const CURSOR_VERSION_FLOOR = "2026.07.09-a3815c0";

const program = new Command();

function buildHarnessManifests() {
  return [
    {
      id: "pr-review",
      prompt: join(appRoot, "config/harnesses/pr-review/prompt.md"),
      skills: [join(appRoot, "config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md")],
    },
  ];
}

function buildDoctorConfig(localConfigPath: string): DoctorConfig {
  const localConfig = loadLocalConfig(localConfigPath);
  const orgConfig = loadOrganizationConfig(
    join(appRoot, "config/organization.json"),
  );

  const profileConfig = loadProfileConfig(
    join(localConfig.profileDirectory, "profile.json"),
  );

  const normalizedLogin = normalizeLogin(profileConfig.githubLogin);

  const catalogMap = new Map<string, string>();
  for (const repo of orgConfig.repositories) {
    catalogMap.set(repo.id, repo.github);
  }

  const policyPath = join(localConfig.profileDirectory, "policy.json");
  const personaPath = join(localConfig.profileDirectory, "persona.md");
  const domainGlobs: string[] = [];
  if (existsSync(policyPath)) {
    try {
      const policy = loadPolicyConfig(policyPath);
      const globSet = new Set<string>();
      for (const repoPolicy of Object.values(policy.repositories)) {
        for (const path of repoPolicy.eligiblePaths) globSet.add(path);
        for (const rule of repoPolicy.domainRules) {
          for (const path of rule.paths) globSet.add(path);
        }
        for (const rule of repoPolicy.priorityRules) {
          for (const path of rule.paths) globSet.add(path);
        }
      }
      domainGlobs.push(...globSet);
    } catch {
      // Policy may exist but be invalid; schema check will catch it.
    }
  }

  return {
    githubHost: orgConfig.github.host,
    configuredLogin: normalizedLogin,
    cursorBinary: localConfig.cursor.binary,
    cursorVersionFloor: CURSOR_VERSION_FLOOR,
    dataDirectory: localConfig.dataDirectory,
    daemonPort: localConfig.daemon?.port ?? 9120,
    repositoryPaths: localConfig.repositoryPaths,
    repositoryCatalog: catalogMap,
    modelRoles: localConfig.cursor.modelRoles,
    profilePath: join(localConfig.profileDirectory, "profile.json"),
    policyPath: existsSync(policyPath) ? policyPath : null,
    personaPath: existsSync(personaPath) ? personaPath : null,
    harnessManifests: buildHarnessManifests(),
    domainGlobs,
  };
}

function createDefaultDoctorDeps(cursorBinary: string) {
  const execCommand = (cmd: string, args: string[], env?: Record<string, string>) => {
    return execFileSync(cmd, args, {
      encoding: "utf-8" as const,
      timeout: 30_000,
      env: env ?? process.env as Record<string, string>,
    }).trim();
  };

  return {
    execCommand,
    checkDiskSpace: () => 20 * 1024 * 1024 * 1024,
    checkPortAvailable: (port: number) => probePortAvailable(port),
    smokeModel: (modelId: string) => {
      let modelsOut: string;
      try {
        modelsOut = execCommand(cursorBinary, ["models"]);
      } catch {
        modelsOut = execCommand(cursorBinary, ["models", "--format", "json"]);
      }
      const available = parseAgentModelsOutput(modelsOut);
      const ok = available.includes(modelId);
      return {
        ok,
        reportedModelId: ok ? modelId : (available[0] ?? ""),
      };
    },
  };
}

async function runDoctorWorkflow(localConfigPath: string): Promise<boolean> {
  const doctorConfig = buildDoctorConfig(localConfigPath);
  const defaultDeps = createDefaultDoctorDeps(doctorConfig.cursorBinary);
  const results = await runDoctor(doctorConfig, defaultDeps);

  let hasFailure = false;
  for (const r of results) {
    const icon = r.ok ? "\u2713" : (r.severity === "warn" ? "\u26A0" : "\u2717");
    console.log(`  ${icon} ${r.name}: ${r.message}`);
    if (!r.ok) hasFailure = true;
  }

  return hasFailure;
}

program
  .name("ct")
  .description("Principal Engineer Control Tower")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check environment readiness")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error(`Local config not found at ${localConfigPath}`);
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const hasFailure = await runDoctorWorkflow(localConfigPath);

    if (hasFailure) {
      console.log("\nDoctor found issues. Fix them and re-run.");
      process.exit(1);
    } else {
      console.log("\nAll checks passed.");
    }
  });

program
  .command("init")
  .description("Initialize Control Tower profile and config")
  .option("--non-interactive", "Skip prompts (use defaults)")
  .option("--github-login <login>", "Set GitHub login")
  .action(async (opts) => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");
    const result = runInit({
      appRoot,
      configPath: localConfigPath,
      nonInteractive: opts.nonInteractive ?? false,
      answers: opts.githubLogin ? { githubLogin: opts.githubLogin } : undefined,
    });
    if (result.profileCreated) {
      console.log(`Created profile at ${result.profileDirectory}`);
    } else {
      console.log(`Profile already exists at ${result.profileDirectory}`);
    }
    if (result.dataCreated) {
      console.log(`Created data directory at ${result.dataDirectory}`);
    }
    if (result.configCreated) {
      console.log("Created local config from example template");
    }
    if (result.publicationModeEnforced) {
      console.log("Enforced publication.mode = \"shadow\" (required for initial setup)");
    }
    if (result.discoveredRepos.length > 0) {
      console.log(`\nDiscovered ${result.discoveredRepos.length} repo(s) in workspace roots`);
    }

    if (opts.nonInteractive) {
      console.log("\nRunning doctor...");
      result.doctorRan = true;
      const hasFailure = await runDoctorWorkflow(localConfigPath);
      if (hasFailure) {
        console.log("\nDoctor found issues. Fix them and re-run.");
        process.exit(1);
      }
      console.log("\nAll checks passed.");
      return;
    }

    console.log("\nEdit your profile and config, then run `pnpm ct doctor`");
  });

program
  .command("start")
  .description("Start the Control Tower daemon")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const localConfig = loadLocalConfig(localConfigPath);
    const port = localConfig.daemon?.port ?? 9120;
    const msg = await startCommand(localConfig.dataDirectory, port);
    console.log(msg);
  });

program
  .command("stop")
  .description("Stop the Control Tower daemon")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const localConfig = loadLocalConfig(localConfigPath);
    const msg = await stopCommand(localConfig.dataDirectory);
    console.log(msg);
  });

program
  .command("status")
  .description("Show daemon status")
  .action(() => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const localConfig = loadLocalConfig(localConfigPath);
    const msg = statusCommand(localConfig.dataDirectory);
    console.log(msg);
  });

program
  .command("reset")
  .description(
    "Wipe local Control Tower data (default) or all local state; never touches repo harnesses",
  )
  .option("--all", "Also wipe config.json and profile/ (requires re-init)")
  .option("--yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    const scope: ResetScope = opts.all ? "all" : "data";

    let confirm: ((message: string) => Promise<boolean>) | undefined;
    if (!opts.yes) {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      confirm = async (message) => {
        const answer = await rl.question(`${message} `);
        rl.close();
        return answer.trim().toLowerCase() === "y";
      };
    }

    const result = await runReset({
      configPath: localConfigPath,
      scope,
      yes: opts.yes ?? false,
      confirm,
      stopDaemon: stopCommand,
      log: (message) => console.log(message),
    });

    if (result.aborted) {
      process.exit(1);
    }
  });

const publicationCmd = program
  .command("publication")
  .description("Manage gated publication mode");

publicationCmd
  .command("enable")
  .description("Enable gated publication (requires doctor pass + confirmation)")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ok = await enablePublication({
      configPath: localConfigPath,
      runDoctor: async () => {
        const hasFailure = await runDoctorWorkflow(localConfigPath);
        return { healthy: !hasFailure, issues: hasFailure ? ["doctor failed"] : [] };
      },
      confirm: async (message) => {
        const answer = await rl.question(message + " ");
        rl.close();
        return answer.trim().toLowerCase() === "y";
      },
      log: (message) => console.log(message),
    });

    if (!ok) process.exit(1);
  });

publicationCmd
  .command("disable")
  .description("Disable publication (shadow mode)")
  .action(async () => {
    const localConfigPath =
      process.env.CONTROL_TOWER_CONFIG ??
      join(homedir(), ".control-tower", "config.json");

    if (!existsSync(localConfigPath)) {
      console.error("Run `pnpm ct init` first");
      process.exit(1);
    }

    await disablePublication({
      configPath: localConfigPath,
      log: (message) => console.log(message),
    });
  });

program.parse();
