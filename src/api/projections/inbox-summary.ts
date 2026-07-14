import type { InboxSummary, ReviewQueueRow } from "../contracts.js";
import { classifyInboxPipeline } from "../../policy/inbox-presentation.js";

export const EMPTY_INBOX_SUMMARY: InboxSummary = {
  readyToReview: 0,
  explicitRequests: 0,
  totalEligible: 0,
  needsAnalysis: 0,
  analyzing: 0,
  failed: 0,
  stale: 0,
  lastPollTimestamp: null,
};

export function projectInboxSummary(
  rows: ReviewQueueRow[],
  lastPollTimestamp: string | null,
): InboxSummary {
  const summary: InboxSummary = {
    ...EMPTY_INBOX_SUMMARY,
    totalEligible: rows.length,
    lastPollTimestamp,
  };

  for (const row of rows) {
    if (row.explicitRequest) {
      summary.explicitRequests += 1;
    }

    const bucket = classifyInboxPipeline(row.jobState);
    if (bucket === "ready") {
      summary.readyToReview += 1;
    } else if (bucket === "analyzing") {
      summary.analyzing += 1;
    } else if (bucket === "failed") {
      summary.failed += 1;
    } else {
      summary.needsAnalysis += 1;
    }

    if (row.stale) {
      summary.stale += 1;
    }
  }

  return summary;
}
