import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const PR_REVIEW_PLUGIN_NAME = "control-tower-pr-review";
export const PR_REVIEW_PLUGIN_RELATIVE_DIR = "config/plugins/control-tower-pr-review";

export function resolvePrReviewPluginDir(appRoot: string): string {
  return join(appRoot, PR_REVIEW_PLUGIN_RELATIVE_DIR);
}

export function resolvePrReviewPluginJsonPath(appRoot: string): string {
  return join(resolvePrReviewPluginDir(appRoot), ".cursor-plugin", "plugin.json");
}

export function resolvePrReviewPromptPath(appRoot: string): string {
  return join(resolvePrReviewPluginDir(appRoot), "prompt.md");
}

export function resolvePrReviewSkillPath(appRoot: string): string {
  return join(
    resolvePrReviewPluginDir(appRoot),
    "skills",
    "control-tower-pr-review",
    "SKILL.md",
  );
}

export function resolvePrReviewDomainRulesDir(appRoot: string): string {
  return join(resolvePrReviewPluginDir(appRoot), "rules");
}

export interface PrReviewPluginManifest {
  name: string;
  version?: string;
  description?: string;
}

export function assertPrReviewPluginPresent(appRoot: string): string {
  const pluginDir = resolvePrReviewPluginDir(appRoot);
  const pluginJsonPath = resolvePrReviewPluginJsonPath(appRoot);
  if (!existsSync(pluginDir) || !existsSync(pluginJsonPath)) {
    throw new Error(
      `control-tower-pr-review plugin missing at ${pluginDir} (expected .cursor-plugin/plugin.json)`,
    );
  }
  let manifest: PrReviewPluginManifest;
  try {
    manifest = JSON.parse(readFileSync(pluginJsonPath, "utf-8")) as PrReviewPluginManifest;
  } catch (err) {
    throw new Error(
      `invalid plugin.json at ${pluginJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (manifest.name !== PR_REVIEW_PLUGIN_NAME) {
    throw new Error(
      `plugin name must be "${PR_REVIEW_PLUGIN_NAME}", got "${manifest.name ?? ""}"`,
    );
  }
  return pluginDir;
}

/** Strip YAML frontmatter from an .mdc rule file; body must match contract text. */
export function stripMdcFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return content;
  }
  const after = content.slice(end + "\n---".length);
  return after.startsWith("\n") ? after.slice(1) : after;
}
