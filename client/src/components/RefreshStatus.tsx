import type { RefreshPresentation } from "../lib/shell-status.js";

export function RefreshStatus({ tone, label }: RefreshPresentation) {
  return (
    <span
      className={`refresh-status refresh-status--${tone}`}
      role="status"
      aria-label={label}
    >
      <span className="refresh-status__indicator" aria-hidden="true" />
      <span className="refresh-status__label">{label}</span>
    </span>
  );
}
