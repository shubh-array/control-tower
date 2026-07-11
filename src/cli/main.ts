import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import { runDoctor, type DoctorConfig } from "./doctor.js";
import { runInit } from "./init.js";
import { startCommand, stopCommand, statusCommand } from "./daemon-control.js";
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
    let attentionAdvisorEnabled = false;
    try {
      const policy = loadPolicyConfig(policyPath);
      attentionAdvisorEnabled = policy.attentionAdvisor?.enabled ?? false;
    } catch {
      // Policy may not exist yet.
    }

    const domainGlobs: string[] = [];

    const doctorConfig: DoctorConfig = {
      githubHost: orgConfig.github.host,
      configuredLogin: normalizedLogin,
      cursorBinary: localConfig.cursor.binary,
      cursorVersionFloor: CURSOR_VERSION_FLOOR,
      dataDirectory: localConfig.dataDirectory,
      daemonPort: localConfig.daemon?.port ?? 9120,
      repositoryPaths: localConfig.repositoryPaths,
      repositoryCatalog: catalogMap,
      modelRoles: localConfig.cursor.modelRoles,
      attentionAdvisorEnabled,
      profilePath: join(localConfig.profileDirectory, "profile.json"),
      policyPath: existsSync(policyPath) ? policyPath : null,
      harnessManifests: [],
      domainGlobs,
    };

    const defaultDeps = {
      execCommand: (cmd: string, args: string[], env?: Record<string, string>) => {
        return execFileSync(cmd, args, {
          encoding: "utf-8" as const,
          timeout: 30_000,
          env: env ?? process.env as Record<string, string>,
        }).trim();
      },
      checkDiskSpace: () => 20 * 1024 * 1024 * 1024,
      checkPortAvailable: (port: number) => {
        try {
          const srv = createNetServer();
          srv.listen(port, "127.0.0.1");
          srv.close();
          return true;
        } catch {
          return false;
        }
      },
    };

    const results = await runDoctor(doctorConfig, defaultDeps);

    let hasFailure = false;
    for (const r of results) {
      const icon = r.ok ? "\u2713" : (r.severity === "warn" ? "\u26A0" : "\u2717");
      console.log(`  ${icon} ${r.name}: ${r.message}`);
      if (!r.ok) hasFailure = true;
    }

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
  .action((opts) => {
    const result = runInit({
      appRoot,
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

program.parse();
