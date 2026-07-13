import type { InboxChip } from "../lib/queue-display.js";

const LABELS: Record<InboxChip, string> = {
  "needs-analysis": "Needs analysis",
  analyzing: "Analyzing",
  ready: "Ready",
  waiting: "Waiting",
  failed: "Failed",
};

interface StatusBadgeProps {
  status: InboxChip;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const label = LABELS[status];

  return (
    <span
      className={`status-badge status-badge--${status}`}
      role="status"
      aria-label={`Status: ${label}`}
    >
      {label}
    </span>
  );
}
