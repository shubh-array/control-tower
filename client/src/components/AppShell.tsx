import type { ReactNode } from "react";
import type {
  ConnectionPresentation,
  RefreshPresentation,
} from "../lib/shell-status.js";
import { PRIMARY_NAV, type PrimaryPage } from "../lib/navigation.js";
import { ActionButton } from "./ActionButton.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { RefreshStatus } from "./RefreshStatus.js";

export interface AppShellProps {
  active: PrimaryPage;
  onNavigate: (page: PrimaryPage) => void;
  connection: ConnectionPresentation;
  refresh: RefreshPresentation;
  showUnavailableBanner: boolean;
  showStaleBanner: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onRetryConnection?: () => void;
  onRetryRefresh?: () => void;
  children: ReactNode;
}

export function AppShell({
  active,
  onNavigate,
  connection,
  refresh,
  showUnavailableBanner,
  showStaleBanner,
  isRefreshing,
  onRefresh,
  onRetryConnection,
  onRetryRefresh,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand-group">
          <p className="app-shell__brand">Control Tower</p>
          <nav className="primary-nav" aria-label="Primary">
            {PRIMARY_NAV.map((item) => {
              const isActive = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={
                    isActive
                      ? "primary-nav__link primary-nav__link--active"
                      : "primary-nav__link"
                  }
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="app-header__status-group">
          <ConnectionStatus {...connection} />
          <RefreshStatus {...refresh} />
          <ActionButton
            quiet
            type="button"
            busy={isRefreshing}
            busyLabel="Refreshing…"
            onClick={onRefresh}
          >
            Refresh
          </ActionButton>
        </div>
      </header>

      {showUnavailableBanner && (
        <div className="shell-alert shell-alert--unavailable" role="alert">
          <p className="shell-alert__message">Control Tower is unavailable.</p>
          {onRetryConnection !== undefined && (
            <ActionButton quiet type="button" onClick={onRetryConnection}>
              Retry connection
            </ActionButton>
          )}
        </div>
      )}

      {showStaleBanner && !showUnavailableBanner && (
        <div className="shell-alert shell-alert--stale" role="status">
          <p className="shell-alert__message">
            Showing last-known data. Refresh failed.
          </p>
          {onRetryRefresh !== undefined && (
            <ActionButton quiet type="button" onClick={onRetryRefresh}>
              Retry refresh
            </ActionButton>
          )}
        </div>
      )}

      <main className="app-shell__main">{children}</main>
    </div>
  );
}
