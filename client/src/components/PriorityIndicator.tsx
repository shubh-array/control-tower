interface PriorityIndicatorProps {
  priority: string;
}

export function PriorityIndicator({ priority }: PriorityIndicatorProps) {
  const label = priority.toUpperCase();

  return (
    <span
      className={`priority-indicator priority-indicator--${priority}`}
      aria-label={`Priority: ${label}`}
    >
      {label}
    </span>
  );
}
