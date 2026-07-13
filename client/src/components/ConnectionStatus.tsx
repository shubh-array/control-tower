import type { ConnectionPresentation } from "../lib/shell-status.js";

export function ConnectionStatus({
  state,
  label,
}: ConnectionPresentation) {
  return (
    <span
      className={`connection-status connection-status--${state}`}
      role="status"
      aria-label={label}
    >
      <span className="connection-status__indicator" aria-hidden="true" />
      <span className="connection-status__label">{label}</span>
    </span>
  );
}
