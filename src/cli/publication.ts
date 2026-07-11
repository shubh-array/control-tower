import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PublicationCliOptions {
  configPath: string;
  runDoctor: () => Promise<{ healthy: boolean; issues: string[] }>;
  confirm: (message: string) => Promise<boolean>;
  log: (message: string) => void;
}

export async function enablePublication(
  opts: PublicationCliOptions,
): Promise<boolean> {
  const doctorResult = await opts.runDoctor();
  if (!doctorResult.healthy) {
    opts.log("Cannot enable publication: doctor reports unhealthy state");
    for (const issue of doctorResult.issues) {
      opts.log(`  - ${issue}`);
    }
    return false;
  }

  const configPath = resolve(opts.configPath);
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  if (config.publication?.mode === "gated") {
    opts.log("Publication is already enabled (gated mode).");
    return true;
  }

  const confirmed = await opts.confirm(
    `Enable gated publication for operator "${config.profileId ?? "unknown"}"? ` +
    "This allows the publisher to create GitHub reviews on your behalf. [y/N]",
  );

  if (!confirmed) {
    opts.log("Aborted.");
    return false;
  }

  config.publication = { ...config.publication, mode: "gated" };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  opts.log("Publication mode set to gated.");
  return true;
}

export async function disablePublication(
  opts: Pick<PublicationCliOptions, "configPath" | "log">,
): Promise<void> {
  const configPath = resolve(opts.configPath);
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  config.publication = { ...config.publication, mode: "shadow" };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  opts.log("Publication mode set to shadow. Publisher disabled.");
}
