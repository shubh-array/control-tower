import type { InboxSummary } from "./api.js";

export function formatLastSynced(timestamp: string | null): string {
  if (timestamp === null) {
    return "Last synced: not yet";
  }

  const syncedAt = Date.parse(timestamp);
  if (Number.isNaN(syncedAt)) {
    return "Last synced: unknown";
  }

  const elapsedMs = Date.now() - syncedAt;
  if (elapsedMs < 0) {
    return "Last synced: just now";
  }

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return "Last synced: just now";
  }
  if (minutes < 60) {
    return `Last synced: ${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Last synced: ${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `Last synced: ${days}d ago`;
}

export function formatInboxSubtitle(summary: InboxSummary): string {
  return `${summary.readyToReview} ready · ${summary.explicitRequests} explicit requests · ${summary.totalEligible} eligible`;
}

export interface InboxPipelineStat {
  key: string;
  label: string;
  value: number;
  tone?: "default" | "accent" | "warning" | "danger";
}

export function buildSecondaryPipelineStats(
  summary: InboxSummary,
): InboxPipelineStat[] {
  const stats: InboxPipelineStat[] = [];

  if (summary.needsAnalysis > 0) {
    stats.push({
      key: "needs-analysis",
      label: "Needs analysis",
      value: summary.needsAnalysis,
    });
  }
  if (summary.analyzing > 0) {
    stats.push({
      key: "analyzing",
      label: "Analyzing",
      value: summary.analyzing,
    });
  }
  if (summary.failed > 0) {
    stats.push({
      key: "failed",
      label: "Failed",
      value: summary.failed,
      tone: "danger",
    });
  }
  if (summary.stale > 0) {
    stats.push({
      key: "stale",
      label: "Stale drafts",
      value: summary.stale,
      tone: "warning",
    });
  }

  return stats;
}
