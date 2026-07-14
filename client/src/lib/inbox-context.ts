import type { FocusQueueRow } from "./api.js";
import { summarizeReasons } from "./queue-display.js";

export interface InboxContextItem {
  label: "Priority" | "Attention reason";
  value: string;
}

function formatPriority(priority: string): string {
  if (priority === "unranked") {
    return "Unranked";
  }
  return priority.toUpperCase();
}

function formatAttentionReason(raw: string): string {
  if (raw === "explicit review request") {
    return "Explicit review request";
  }
  if (raw === "eligible author") {
    return "Eligible author";
  }
  if (raw.startsWith("eligible path")) {
    const [head, ...rest] = raw.split(" · ");
    const formattedHead =
      head && head.length > 0
        ? head.charAt(0).toUpperCase() + head.slice(1)
        : "Eligible path";
    return rest.length > 0
      ? [formattedHead, ...rest].join(" · ")
      : formattedHead;
  }
  if (raw.length === 0) {
    return raw;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function buildInboxContext(item: FocusQueueRow): InboxContextItem[] {
  return [
    { label: "Priority", value: formatPriority(item.priority) },
    {
      label: "Attention reason",
      value: formatAttentionReason(summarizeReasons(item)),
    },
  ];
}
