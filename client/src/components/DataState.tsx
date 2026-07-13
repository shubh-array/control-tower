import type { ReactNode } from "react";
import { ActionButton } from "./ActionButton.js";
import { EmptyState } from "./EmptyState.js";

interface DataStateProps {
  isLoading: boolean;
  showError: boolean;
  isStale: boolean;
  loadingMessage?: string;
  errorTitle?: string;
  errorMessage?: string;
  staleMessage?: string;
  onRetry?: () => void;
  children?: ReactNode;
}

export function DataState({
  isLoading,
  showError,
  isStale,
  loadingMessage = "Loading…",
  errorTitle = "Could not load data",
  errorMessage = "Something went wrong.",
  staleMessage = "Showing cached data",
  onRetry,
  children,
}: DataStateProps) {
  if (isLoading) {
    return (
      <div className="data-state data-state--loading" role="status" aria-live="polite">
        <p className="data-state__message">{loadingMessage}</p>
      </div>
    );
  }

  if (showError) {
    return (
      <EmptyState
        title={errorTitle}
        body={errorMessage}
        action={
          onRetry !== undefined ? (
            <ActionButton type="button" onClick={onRetry}>
              Retry
            </ActionButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      {isStale && (
        <div className="data-state data-state--stale" role="status" aria-live="polite">
          <p className="data-state__message">{staleMessage}</p>
          {onRetry !== undefined && (
            <ActionButton quiet type="button" onClick={onRetry}>
              Retry refresh
            </ActionButton>
          )}
        </div>
      )}
      {children}
    </>
  );
}
