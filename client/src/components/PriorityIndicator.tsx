interface PriorityIndicatorProps {
  priority: string;
}

function formatPriorityLabel(priority: string): string {
  if (priority === "unranked") {
    return "Unranked";
  }
  return priority.toUpperCase();
}

export function PriorityIndicator({ priority }: PriorityIndicatorProps) {
  const label = formatPriorityLabel(priority);

  return (
    <span
      className={`priority-indicator priority-indicator--${priority}`}
      aria-label={`Priority: ${label}`}
    >
      {label}
    </span>
  );
}
