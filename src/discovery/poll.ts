import type {
  HostHealth,
  DiscoveredPr,
  GhSearchPrItem,
  GhPrListItem,
} from "../github/types.js";
import type { PolicyDecision } from "../policy/evaluate.js";

export interface DiscoveryDeps {
  verifyIdentity: () => Promise<HostHealth>;
  searchReviewRequested: (
    login: string,
    orgs: string[],
  ) => Promise<GhSearchPrItem[]>;
  listRepoPrs: (ownerRepo: string) => Promise<GhPrListItem[]>;
  enrichPr: (ownerRepo: string, prNumber: number) => Promise<unknown | null>;
  normalizePr: (
    raw: unknown,
    repositoryId: string,
    explicitRequest: boolean,
  ) => DiscoveredPr;
  upsertRepository: (repo: {
    id: string;
    github: string;
    host: string;
    defaultBranch?: string;
    resourceClass?: string;
  }) => void;
  upsertPr: (pr: DiscoveredPr) => number;
  evaluatePolicy: (pr: DiscoveredPr) => PolicyDecision;
  persistDecision?: (
    prId: number,
    pr: DiscoveredPr,
    decision: PolicyDecision,
  ) => void;
  checkpoint: {
    getLastPollTime: (host: string) => string | null;
    setLastPollTime: (host: string) => void;
  };
  /** Production should wrap with ResilientPoller or pass rateLimit here. */
  rateLimit?: {
    isAvailable: () => boolean;
    refresh?: () => Promise<void>;
  };
  config: {
    host: string;
    organizations: string[];
    operatorLogin: string;
    activeRepositoryIds: string[];
    repositories: Array<{ id: string; github: string }>;
    pollIntervalSeconds: number;
  };
}

export interface PollResult {
  skipped: boolean;
  reason?: string;
  discoveredCount: number;
  host: HostHealth | null;
  decisions: Array<{ prId: number; decision: PolicyDecision }>;
}

interface SeenEntry {
  raw: unknown;
  repositoryId: string;
  github: string;
  explicitRequest: boolean;
  prNumber: number;
}

export class DiscoveryPoller {
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: DiscoveryDeps) {}

  async poll(): Promise<PollResult> {
    const health = await this.deps.verifyIdentity();

    if (!health.healthy) {
      return {
        skipped: true,
        reason: `Host unhealthy: ${health.error}`,
        discoveredCount: 0,
        host: health,
        decisions: [],
      };
    }

    if (this.deps.rateLimit && !this.deps.rateLimit.isAvailable()) {
      if (this.deps.rateLimit.refresh) {
        await this.deps.rateLimit.refresh();
      }
      if (!this.deps.rateLimit.isAvailable()) {
        return {
          skipped: true,
          reason: "GitHub rate limit exhausted — skipping discovery poll",
          discoveredCount: 0,
          host: health,
          decisions: [],
        };
      }
    }

    const seen = new Map<string, SeenEntry>();

    const explicitResults = await this.deps.searchReviewRequested(
      this.deps.config.operatorLogin,
      this.deps.config.organizations,
    );

    for (const pr of explicitResults) {
      const key = `${pr.repository.nameWithOwner}#${pr.number}`;
      const repoConfig = this.deps.config.repositories.find(
        (r) => r.github === pr.repository.nameWithOwner,
      );
      const repoId =
        repoConfig?.id ??
        `github:${this.deps.config.host}/${pr.repository.nameWithOwner}`;
      seen.set(key, {
        raw: pr,
        repositoryId: repoId,
        github: pr.repository.nameWithOwner,
        explicitRequest: true,
        prNumber: pr.number,
      });
    }

    for (const repo of this.deps.config.repositories) {
      if (!this.deps.config.activeRepositoryIds.includes(repo.id)) {
        continue;
      }

      const prs = await this.deps.listRepoPrs(repo.github);
      for (const pr of prs) {
        const key = `${repo.github}#${pr.number}`;
        if (!seen.has(key)) {
          seen.set(key, {
            raw: pr,
            repositoryId: repo.id,
            github: repo.github,
            explicitRequest: false,
            prNumber: pr.number,
          });
        }
      }
    }

    const decisions: Array<{ prId: number; decision: PolicyDecision }> = [];

    for (const [, entry] of seen) {
      this.deps.upsertRepository({
        id: entry.repositoryId,
        github: entry.github,
        host: this.deps.config.host,
      });

      let raw = entry.raw;
      const enriched = await this.deps.enrichPr(entry.github, entry.prNumber);
      if (enriched !== null) {
        raw = enriched;
      }

      const discovered = this.deps.normalizePr(
        raw,
        entry.repositoryId,
        entry.explicitRequest,
      );

      const prId = this.deps.upsertPr(discovered);
      const decision = this.deps.evaluatePolicy(discovered);
      decisions.push({ prId, decision });

      if (this.deps.persistDecision) {
        this.deps.persistDecision(prId, discovered, decision);
      }
    }

    this.deps.checkpoint.setLastPollTime(this.deps.config.host);

    return {
      skipped: false,
      discoveredCount: seen.size,
      host: health,
      decisions,
    };
  }

  async refresh(): Promise<PollResult> {
    return this.poll();
  }

  start(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      this.poll().catch(() => {});
    }, this.deps.config.pollIntervalSeconds * 1000);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
