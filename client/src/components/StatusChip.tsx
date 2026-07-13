import { StatusBadge } from "./StatusBadge.js";
import type { InboxChip } from "../lib/queue-display.js";

interface StatusChipProps {
  status: InboxChip;
}

export function StatusChip({ status }: StatusChipProps) {
  return <StatusBadge status={status} />;
}
