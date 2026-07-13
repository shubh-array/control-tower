export function isLatestHealthRequest(
  requestId: number,
  latestRequestId: number,
): boolean {
  return requestId === latestRequestId;
}

export type HealthBanner = "unavailable" | null;

/**
 * Shell banner is only for unreachable API/daemon (spec §9).
 * A successful health response that reports healthy:false is degraded
 * operational state (e.g. failed jobs), not a connection outage.
 */
export function resolveHealthBanner(
  outcome:
    | { kind: "ok"; healthy: boolean; issues?: string[] }
    | { kind: "error" },
): HealthBanner {
  if (outcome.kind === "error") {
    return "unavailable";
  }
  return null;
}
