import type { HostHealth, GhSearchPrItem, GhPrListItem } from "../github/types.js";
import type { RateLimitTracker } from "../github/rate-limit.js";
import type { GhExecOptions } from "../github/gh-process.js";

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

  constructor(private readonly deps: ResilientPollDeps) {}

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
      const seen = new Map<
        string,
        { raw: unknown; repositoryId: string; explicitRequest: boolean }
      >();

      const explicit = await this.deps.searchReviewRequested(
        this.deps.config.operatorLogin,
        this.deps.config.organizations,
      );
      for (const pr of explicit) {
        const key = `${pr.repository.nameWithOwner}#${pr.number}`;
        const repo = this.deps.config.repositories.find(
          (r) => r.github === pr.repository.nameWithOwner,
        );
        const repositoryId =
          repo?.id ??
          `github:${this.deps.config.host}/${pr.repository.nameWithOwner}`;
        seen.set(key, { raw: pr, repositoryId, explicitRequest: true });
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
              explicitRequest: false,
            });
          }
        }
      }

      for (const [, entry] of seen) {
        const prId = this.deps.upsertPr(
          entry.raw,
          entry.repositoryId,
          entry.explicitRequest,
        );
        this.deps.evaluateAndEnqueue(prId, entry.raw, entry.explicitRequest);
      }

      const now = new Date().toISOString();
      this.deps.setFreshnessAt(this.deps.config.host, now);
      this.failureAttempt = 0;

      return {
        coverageComplete: true,
        freshnessAt: now,
        hostHealthy: true,
        knownPrCount: this.deps.countKnownPrs(),
        discoveredCount: seen.size,
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
