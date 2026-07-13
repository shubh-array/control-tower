export interface OrganizationConfig {
  schemaVersion: number;
  github: {
    host: string;
    organizations: string[];
    pollIntervalSeconds: number;
  };
  security: {
    protectedPaths: string[];
  };
  reviewDefaults: {
    jobTimeoutSeconds: number;
    retentionDays: number;
    maxStorageBytes: number;
  };
  repositories: Array<{
    id: string;
    github: string;
    defaultBranch: string;
    resourceClass: "light" | "medium" | "heavy";
  }>;
}

export interface ProfileConfig {
  schemaVersion: number;
  profileId: string;
  githubLogin: string;
  activeRepositoryIds: string[];
}

export interface DomainRule {
  domain: string;
  paths: string[];
  priority: number;
}

export interface PriorityRule {
  paths: string[];
  tier: "p0" | "p1" | "p2" | "p3";
}

export interface RepositoryPolicy {
  eligiblePaths: string[];
  eligibleAuthors: string[];
  domainRules: DomainRule[];
  priorityRules: PriorityRule[];
}

export interface PolicyConfig {
  schemaVersion: number;
  autoAnalyze: {
    explicitReviewRequests: boolean;
    priorityTiers: Array<"p0" | "p1" | "p2" | "p3">;
  };
  repositories: Record<string, RepositoryPolicy>;
}

export interface ModelRoleSpec {
  modelId: string;
}

export interface LocalConfig {
  schemaVersion: number;
  profileDirectory: string;
  dataDirectory: string;
  workspaceRoots: string[];
  repositoryPaths: Record<string, string>;
  cursor: {
    binary: string;
    modelRoles: {
      primaryReview: ModelRoleSpec;
    };
    maxConcurrentAgents: number;
  };
  worktrees: {
    maxMaterialized: number;
  };
  publication: {
    mode: "shadow" | "gated";
  };
  daemon: {
    port: number;
  };
}
