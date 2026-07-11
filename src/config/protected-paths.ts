import { CanonicalPathMatcher, type PatternSource } from "../paths/matcher.js";

const APP_DEFAULT_PROTECTED_PATHS: readonly string[] = [
  "**/.env",
  "**/.env.*",
  "**/.cursor/mcp.json",
  "**/appsettings.secrets.json",
  "**/appsettings.Local.json",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
  "**/deploy.*.parameters.json",
  "**/deploy.*.parameters.jsonc",
];

export function buildProtectedPathMatcher(
  orgProtectedPaths: readonly string[],
): CanonicalPathMatcher {
  const inputs: PatternSource[] = [];

  for (const p of APP_DEFAULT_PROTECTED_PATHS) {
    inputs.push({ pattern: p, source: "app-defaults" });
  }

  for (const p of orgProtectedPaths) {
    inputs.push({ pattern: p, source: "org-security" });
  }

  return CanonicalPathMatcher.compile(inputs);
}

export { APP_DEFAULT_PROTECTED_PATHS };
