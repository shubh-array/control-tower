import type { HostHealth, GhSearchPrItem, GhPrListItem } from "../github/types.js";
import type { RateLimitTracker } from "../github/rate-limit.js";
import type { GhExecOptions } from "../github/gh-process.js";
import {
  DiscoveryPoller,
  type DiscoveryDeps,
} from "./poll.js";
import type { PolicyDecision } from "../policy/evaluate.js";
import { toDiscoveredPr } from "../normalize/from-gh.js";

type ExecGhJsonFn = <T>(args: string[], options: GhExecOptions) => Promise<T>;

export interface PollResult {
  coverageComplete: boolean;
  freshnessAt: string | null;
  hostHealthy: boolean;
  knownPrCount: number;
  reason?: string;
  discoveredCount: number;
}

export interface ResilientPollConfig {
  host: string;
  organizations: string[];
  operatorLogin: string;
  activeRepositoryIds: string[];
  repositories: Array<{ id: string; github: string }>;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export interface ResilientPollDeps {
  verifyIdentity: () => Promise<HostHealth>;
  searchReviewRequested: (
    login: string,
    orgs: string[],
  ) => Promise<GhSearchPrItem[]>;
  listRepoPrs: (ownerRepo: string) => Promise<GhPrListItem[]>;
  upsertRepository: (repo: {
    id: string;
    github: string;
    host: string;
    defaultBranch?: string;
    resourceClass?: string;
  }) => void;
  upsertPr: (
    raw: unknown,
    repositoryId: string,
    explicitRequest: boolean,
  ) => number;
  /** Plan 03 enqueue boundary — must NOT be called on failure / identity mismatch. */
  evaluateAndEnqueue: (
    prId: number,
    raw: unknown,
    explicitRequest: boolean,
  ) => void;
  countKnownPrs: () => number;
  getFreshnessAt: (host: string) => string | null;
  setFreshnessAt: (host: string, at: string) => void;
  rateLimits: RateLimitTracker;
  scheduleNextPoll: (delayMs: number) => void;
  config: ResilientPollConfig;
  random: () => number;
  execGhJson?: ExecGhJsonFn;
}

export interface BackoffInput {
  attempt: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  random: () => number;
}

/** Exponential backoff with jitter in [0.5, 1.5) × capped base. */
export function scheduleBackoff(input: BackoffInput): number {
  const exp = Math.min(
    input.maxBackoffMs,
    input.baseBackoffMs * 2 ** input.attempt,
  );
  const jitter = 0.5 + input.random();
  return Math.min(input.maxBackoffMs * 1.5, Math.floor(exp * jitter));
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { status?: number; message?: string };
  if (e.status === 403 || e.status === 429) {
    return true;
  }
  return /rate.?limit/i.test(e.message ?? "");
}

export class ResilientPoller {
  private failureAttempt = 0;
  private readonly discoveryPoller: DiscoveryPoller;

  constructor(private readonly deps: ResilientPollDeps) {
    this.discoveryPoller = new DiscoveryPoller(this.buildDiscoveryDeps());
  }

  async poll(): Promise<PollResult> {
    const knownPrCount = this.deps.countKnownPrs();
    const lastFreshness = this.deps.getFreshnessAt(this.deps.config.host);

    const health = await this.deps.verifyIdentity();
    if (!health.healthy) {
      return {
        coverageComplete: false,
        freshnessAt: lastFreshness,
        hostHealthy: false,
        knownPrCount,
        discoveredCount: 0,
        reason: health.error ?? "Host unhealthy: operator identity mismatch",
      };
    }

    if (
      !this.deps.rateLimits.isAvailable("search") ||
      !this.deps.rateLimits.isAvailable("core")
    ) {
      this.backoffAndSchedule();
      return {
        coverageComplete: false,
        freshnessAt: lastFreshness,
        hostHealthy: true,
        knownPrCount,
        discoveredCount: 0,
        reason: "GitHub rate limit exhausted — preserving last-known state",
      };
    }

    try {
      const discoveryResult = await this.discoveryPoller.poll();
      if (discoveryResult.skipped) {
        if (discoveryResult.reason?.match(/rate.?limit/i)) {
          this.backoffAndSchedule();
        }
        return {
          coverageComplete: false,
          freshnessAt: lastFreshness,
          hostHealthy: discoveryResult.host?.healthy ?? true,
          knownPrCount,
          discoveredCount: 0,
          reason: discoveryResult.reason,
        };
      }

      const now = new Date().toISOString();
      this.deps.setFreshnessAt(this.deps.config.host, now);
      this.failureAttempt = 0;

      return {
        coverageComplete: true,
        freshnessAt: now,
        hostHealthy: true,
        knownPrCount: this.deps.countKnownPrs(),
        discoveredCount: discoveryResult.discoveredCount,
      };
    } catch (err) {
      if (isRateLimitError(err) && this.deps.execGhJson) {
        await this.deps.rateLimits.refresh(
          this.deps.config.host,
          this.deps.execGhJson,
        );
      }
      this.backoffAndSchedule();
      return {
        coverageComplete: false,
        freshnessAt: lastFreshness,
        hostHealthy: true,
        knownPrCount,
        discoveredCount: 0,
        reason:
          err instanceof Error
            ? err.message
            : "GitHub unavailable — preserving last-known state",
      };
    }
  }

  private buildDiscoveryDeps(): DiscoveryDeps {
    return {
      verifyIdentity: async () => {
        const health = await this.deps.verifyIdentity();
        return health;
      },
      searchReviewRequested: this.deps.searchReviewRequested,
      listRepoPrs: this.deps.listRepoPrs,
      enrichPr: async () => null,
      normalizePr: (raw, repositoryId, explicitRequest) =>
        toDiscoveredPr(
          raw as GhSearchPrItem | GhPrListItem,
          repositoryId,
          explicitRequest,
        ),
      upsertRepository: this.deps.upsertRepository,
      upsertPr: (discovered) => {
        const prId = this.deps.upsertPr(
          discovered,
          discovered.repositoryId,
          discovered.explicitRequest,
        );
        this.deps.evaluateAndEnqueue(
          prId,
          discovered,
          discovered.explicitRequest,
        );
        return prId;
      },
      evaluatePolicy: () => ({}) as PolicyDecision,
      checkpoint: {
        getLastPollTime: this.deps.getFreshnessAt,
        setLastPollTime: (host) => {
          this.deps.setFreshnessAt(host, new Date().toISOString());
        },
      },
      rateLimit: {
        isAvailable: () =>
          this.deps.rateLimits.isAvailable("search") &&
          this.deps.rateLimits.isAvailable("core"),
        refresh: this.deps.execGhJson
          ? async () => {
              await this.deps.rateLimits.refresh(
                this.deps.config.host,
                this.deps.execGhJson!,
              );
            }
          : undefined,
      },
      config: {
        host: this.deps.config.host,
        organizations: this.deps.config.organizations,
        operatorLogin: this.deps.config.operatorLogin,
        activeRepositoryIds: this.deps.config.activeRepositoryIds,
        repositories: this.deps.config.repositories,
        pollIntervalSeconds: 300,
      },
    };
  }

  private backoffAndSchedule(): void {
    const delayMs = scheduleBackoff({
      attempt: this.failureAttempt,
      baseBackoffMs: this.deps.config.baseBackoffMs,
      maxBackoffMs: this.deps.config.maxBackoffMs,
      random: this.deps.random,
    });
    this.failureAttempt += 1;
    this.deps.scheduleNextPoll(delayMs);
  }
}
