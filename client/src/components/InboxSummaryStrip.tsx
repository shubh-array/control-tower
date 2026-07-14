import type { InboxSummary } from "../lib/api.js";
import {
  buildSecondaryPipelineStats,
  formatLastSynced,
} from "../lib/inbox-summary-display.js";

interface InboxSummaryStripProps {
  summary: InboxSummary;
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "accent" | "warning";
}) {
  const valueClass =
    tone === "accent"
      ? "inbox-summary__value inbox-summary__value--accent"
      : tone === "warning"
        ? "inbox-summary__value inbox-summary__value--warning"
        : "inbox-summary__value";

  return (
    <div className="inbox-summary__card">
      <span className={valueClass}>{value}</span>
      <span className="inbox-summary__label">{label}</span>
    </div>
  );
}

export function InboxSummaryStrip({ summary }: InboxSummaryStripProps) {
  const secondaryStats = buildSecondaryPipelineStats(summary);

  return (
    <section className="inbox-summary" aria-label="Inbox summary">
      <div className="inbox-summary__primary">
        <SummaryCard
          label="Ready to review"
          value={summary.readyToReview}
          tone={summary.readyToReview > 0 ? "accent" : "default"}
        />
        <SummaryCard
          label="Explicit requests"
          value={summary.explicitRequests}
          tone={
            summary.explicitRequests > 0 && summary.readyToReview < summary.explicitRequests
              ? "warning"
              : "default"
          }
        />
        <SummaryCard label="Total eligible" value={summary.totalEligible} />
      </div>
      <div className="inbox-summary__secondary">
        {secondaryStats.map((stat) => (
          <span
            key={stat.key}
            className={
              stat.tone === "danger"
                ? "inbox-summary__stat inbox-summary__stat--danger"
                : stat.tone === "warning"
                  ? "inbox-summary__stat inbox-summary__stat--warning"
                  : "inbox-summary__stat"
            }
          >
            {stat.label}: {stat.value}
          </span>
        ))}
        <span className="inbox-summary__stat inbox-summary__stat--sync">
          {formatLastSynced(summary.lastPollTimestamp)}
        </span>
      </div>
    </section>
  );
}
