import type { GhExecOptions } from "./gh-process.js";
import type { GhRateLimit, GhRateLimitResource } from "./types.js";

type ExecGhJsonFn = <T>(args: string[], options: GhExecOptions) => Promise<T>;

export interface RateLimitState {
  core: GhRateLimitResource | null;
  search: GhRateLimitResource | null;
  graphql: GhRateLimitResource | null;
  lastChecked: string | null;
}

export class RateLimitTracker {
  private state: RateLimitState = {
    core: null,
    search: null,
    graphql: null,
    lastChecked: null,
  };

  async refresh(
    host: string,
    execGhJsonFn: ExecGhJsonFn,
  ): Promise<RateLimitState> {
    const data = await execGhJsonFn<GhRateLimit>(["api", "rate_limit"], {
      host,
    });

    this.state = {
      core: data.resources.core,
      search: data.resources.search,
      graphql: data.resources.graphql,
      lastChecked: new Date().toISOString(),
    };

    return this.state;
  }

  isAvailable(resource: "core" | "search" | "graphql"): boolean {
    const rateLimit = this.state[resource];
    if (!rateLimit) {
      return true;
    }
    if (rateLimit.remaining > 0) {
      return true;
    }
    return Date.now() / 1000 >= rateLimit.reset;
  }

  resetTime(resource: "core" | "search" | "graphql"): Date | null {
    const rateLimit = this.state[resource];
    if (!rateLimit || rateLimit.remaining > 0) {
      return null;
    }
    return new Date(rateLimit.reset * 1000);
  }

  getState(): Readonly<RateLimitState> {
    return this.state;
  }
}
