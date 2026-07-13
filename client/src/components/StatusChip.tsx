import type { InboxChip } from "../lib/queue-display.js";

const LABELS: Record<InboxChip, string> = {
  "needs-analysis": "Needs analysis",
  analyzing: "Analyzing",
  ready: "Ready",
  waiting: "Waiting",
  failed: "Failed",
};

interface StatusChipProps {
  status: InboxChip;
}

export function StatusChip({ status }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip--${status}`}>
      {LABELS[status]}
    </span>
  );
}
