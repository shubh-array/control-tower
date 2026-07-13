import { z } from "zod";

export const organizationSchema = z.object({
  schemaVersion: z.literal(1),
  github: z.object({
    host: z.string().min(1),
    organizations: z.array(z.string().min(1)).min(1),
    pollIntervalSeconds: z.number().int().positive(),
  }).strict(),
  security: z.object({
    protectedPaths: z.array(z.string().min(1)),
  }).strict(),
  reviewDefaults: z.object({
    jobTimeoutSeconds: z.number().int().positive(),
    retentionDays: z.number().int().positive(),
    maxStorageBytes: z.number().int().positive(),
  }).strict(),
  repositories: z.array(z.object({
    id: z.string().min(1),
    github: z.string().regex(/^[^/]+\/[^/]+$/),
    defaultBranch: z.string().min(1),
    resourceClass: z.enum(["light", "medium", "heavy"]),
  }).strict()).min(1),
}).strict();

export const profileSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().min(1),
  githubLogin: z.string().min(1),
  activeRepositoryIds: z.array(z.string().min(1)),
}).strict();

const domainRuleSchema = z.object({
  domain: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  priority: z.number().int().min(0).max(1000),
}).strict();

const priorityRuleSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  tier: z.enum(["p0", "p1", "p2", "p3"]),
}).strict();

const repositoryPolicySchema = z.object({
  eligiblePaths: z.array(z.string()),
  eligibleAuthors: z.array(z.string()),
  domainRules: z.array(domainRuleSchema).max(3),
  priorityRules: z.array(priorityRuleSchema),
}).strict();

export const policySchema = z.object({
  schemaVersion: z.literal(1),
  autoAnalyze: z.object({
    explicitReviewRequests: z.boolean(),
    priorityTiers: z.array(z.enum(["p0", "p1", "p2", "p3"])),
  }).strict(),
  repositories: z.record(z.string(), repositoryPolicySchema),
}).strict();

const modelRoleSpecSchema = z.object({
  modelId: z.string().min(1),
}).strict();

export const localConfigSchema = z.object({
  schemaVersion: z.literal(1),
  profileDirectory: z.string().min(1),
  dataDirectory: z.string().min(1),
  workspaceRoots: z.array(z.string().min(1)),
  repositoryPaths: z.record(z.string(), z.string().min(1)),
  cursor: z.object({
    binary: z.string().min(1),
    modelRoles: z.object({
      primaryReview: modelRoleSpecSchema,
    }).strict(),
    maxConcurrentAgents: z.number().int().min(1).max(2),
  }).strict(),
  worktrees: z.object({
    maxMaterialized: z.number().int().min(1),
  }).strict(),
  publication: z.object({
    mode: z.enum(["shadow", "gated"]),
  }).strict(),
  daemon: z.object({
    port: z.number().int().min(1).max(65535).default(9120),
  }).strict().default({ port: 9120 }),
}).strict();
