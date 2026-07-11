import { readFileSync } from "node:fs";
import {
  organizationSchema,
  profileSchema,
  policySchema,
  localConfigSchema,
} from "./schemas.js";
import type {
  OrganizationConfig,
  ProfileConfig,
  PolicyConfig,
  LocalConfig,
} from "./types.js";

export type TicketExtractor = OrganizationConfig["ticketExtractors"][number];

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read config file "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in "${path}"`);
  }
}

function formatZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
}

export function loadOrganizationConfig(path: string): OrganizationConfig {
  const data = readJson(path);
  const result = organizationSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid organization config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadProfileConfig(path: string): ProfileConfig {
  const data = readJson(path);
  const result = profileSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid profile config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadPolicyConfig(path: string): PolicyConfig {
  const data = readJson(path);
  const result = policySchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid policy config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadLocalConfig(path: string): LocalConfig {
  const data = readJson(path);
  const result = localConfigSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid local config "${path}":\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}
