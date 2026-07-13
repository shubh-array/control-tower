import { useCallback, useMemo, useState } from "react";
import { type TrackedQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { ReasonLine } from "../components/ReasonLine.js";
import { ActionButton } from "../components/ActionButton.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { DataState } from "../components/DataState.js";
import { FilterBar } from "../components/FilterBar.js";
import { PageHeader } from "../components/PageHeader.js";
import { PriorityIndicator } from "../components/PriorityIndicator.js";
import {
  type CoverageFilter,
  deriveInboxPresentation,
  filterCoverageRows,
  summarizeReasons,
} from "../lib/queue-display.js";
import {
  INBOX_REFRESH_ERROR,
  inboxRowKey,
  mergeRowPatch,
  patchRowAfterMutation,
} from "../lib/inbox-resilience.js";
import { useAnalyzeMutation } from "../hooks/useJobMutations.js";
import { useQueueQuery } from "../hooks/useQueueQuery.js";

function formatRepoPr(item: TrackedQueueRow): string {
  const repoName = item.repository.split("/").at(-1) ?? item.repository;
  return `${repoName}#${item.prNumber}`;
}

function isAnalyzing(item: TrackedQueueRow): boolean {
  return deriveInboxPresentation(item).chip === "analyzing";
}

function CoverageFeedback({
  text,
}: {
  text: string;
}) {
  return (
    <p className="reason-line" role="alert" aria-live="polite">
      <SafeText text={text} />
    </p>
  );
}

export function CoverageActionCell({
  item,
  pending,
  refreshing,
  actioningElsewhere,
  mutationError,
  refreshError,
  onAction,
  onRefreshRetry,
}: {
  item: TrackedQueueRow;
  pending: boolean;
  refreshing: boolean;
  actioningElsewhere: boolean;
  mutationError: string | undefined;
  refreshError: string | undefined;
  onAction: (item: TrackedQueueRow) => void;
  onRefreshRetry: (item: TrackedQueueRow) => void;
}) {
  const analyzing = isAnalyzing(item);
  const actionLabel = mutationError ? "Retry" : "Analyze";

  return (
    <>
      {mutationError && <CoverageFeedback text={mutationError} />}
      {refreshError && <CoverageFeedback text={refreshError} />}
      {pending ? (
        <ActionButton busy busyLabel="Working…" disabled>
          Analyze
        </ActionButton>
      ) : refreshError ? (
        <>
          {analyzing && <StatusBadge status="analyzing" />}
          <ActionButton
            quiet
            busy={refreshing}
            busyLabel="Refreshing…"
            disabled={refreshing}
            onClick={() => onRefreshRetry(item)}
          >
            Refresh
          </ActionButton>
        </>
      ) : analyzing ? (
        <StatusBadge status="analyzing" />
      ) : (
        <ActionButton
          disabled={actioningElsewhere}
          onClick={() => onAction(item)}
        >
          {actionLabel}
        </ActionButton>
      )}
    </>
  );
}

export function AllTracked() {
  const { allTracked, surface, refetch } = useQueueQuery();
  const analyzeMutation = useAnalyzeMutation();
  const items = allTracked ?? [];
  const loading = surface.isLoading;
  const loadError = surface.showError
    ? (surface.error?.message ?? "Failed to load coverage")
    : null;
  const [filter, setFilter] = useState<CoverageFilter>("eligible");
  const [query, setQuery] = useState("");
  const [actioningKey, setActioningKey] = useState<string | null>(null);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const [mutationErrorByKey, setMutationErrorByKey] = useState<
    Record<string, string>
  >({});
  const [refreshErrorByKey, setRefreshErrorByKey] = useState<
    Record<string, string>
  >({});
  const [rowPatches, setRowPatches] = useState<
    Record<string, Partial<TrackedQueueRow>>
  >({});

  const refetchQueue = useCallback(async () => {
    const result = await refetch();
    if (result.isError) {
      throw result.error;
    }
  }, [refetch]);

  const displayItems = useMemo(
    () => items.map((item) => mergeRowPatch(item, rowPatches)),
    [items, rowPatches],
  );

  const visibleItems = useMemo(
    () => filterCoverageRows(displayItems, filter, query),
    [displayItems, filter, query],
  );

  const clearRowFeedback = useCallback((key: string) => {
    setMutationErrorByKey((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setRefreshErrorByKey((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const clearRowPatch = useCallback((key: string) => {
    setRowPatches((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const refreshAfterMutation = useCallback(
    async (key: string) => {
      try {
        await refetchQueue();
        clearRowPatch(key);
        setRefreshErrorByKey((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } catch {
        setRefreshErrorByKey((prev) => ({
          ...prev,
          [key]: INBOX_REFRESH_ERROR,
        }));
      }
    },
    [clearRowPatch, refetchQueue],
  );

  const handleRefreshRetry = useCallback(
    async (item: TrackedQueueRow) => {
      const key = inboxRowKey(item);
      if (refreshingKey !== null) return;

      setRefreshingKey(key);
      try {
        await refetchQueue();
        clearRowPatch(key);
        setRefreshErrorByKey((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } catch {
        setRefreshErrorByKey((prev) => ({
          ...prev,
          [key]: INBOX_REFRESH_ERROR,
        }));
      } finally {
        setRefreshingKey(null);
      }
    },
    [clearRowPatch, refetchQueue, refreshingKey],
  );

  const handleAnalyze = useCallback(
    async (item: TrackedQueueRow) => {
      const key = inboxRowKey(item);
      if (actioningKey !== null) return;

      setActioningKey(key);
      clearRowFeedback(key);

      try {
        const { jobId } = await analyzeMutation.mutateAsync({
          repositoryKey: item.repositoryKey,
          prNumber: item.prNumber,
        });
        const patched = patchRowAfterMutation(item, jobId);
        setRowPatches((prev) => ({
          ...prev,
          [key]: {
            jobId: patched.jobId,
            jobState: patched.jobState,
          },
        }));
        await refreshAfterMutation(key);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setMutationErrorByKey((prev) => ({ ...prev, [key]: message }));
      } finally {
        setActioningKey(null);
      }
    },
    [actioningKey, analyzeMutation, clearRowFeedback, refreshAfterMutation],
  );

  return (
    <DataState
      isLoading={loading}
      showError={loadError !== null}
      isStale={surface.isStale}
      loadingMessage="Loading coverage…"
      errorTitle="Could not load coverage"
      errorMessage={loadError ?? "Failed to load coverage"}
      onRetry={() => {
        void refetch();
      }}
    >
      <PageHeader title="Coverage" />

      <FilterBar
        options={[
          { value: "eligible", label: "Eligible" },
          { value: "ineligible", label: "Ineligible" },
          { value: "all", label: "All" },
        ]}
        value={filter}
        onChange={setFilter}
        searchValue={query}
        onSearchChange={setQuery}
        searchLabel="Search coverage"
        searchPlaceholder="Search PR, title, or author"
        groupName="coverage-filter"
      />

      <table className="coverage-table">
        <thead>
          <tr>
            <th>PR</th>
            <th>Title</th>
            <th>Author</th>
            <th>Priority</th>
            <th>Why</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((item) => {
            const key = inboxRowKey(item);
            const pending = actioningKey === key;
            const refreshing = refreshingKey === key;

            return (
              <tr key={key}>
                <td>
                  <code>
                    <SafeText text={formatRepoPr(item)} />
                  </code>
                </td>
                <td>
                  <SafeText text={item.title} />
                </td>
                <td>
                  <SafeText text={item.author} />
                </td>
                <td>
                  <PriorityIndicator priority={item.priority} />
                </td>
                <td>
                  <ReasonLine text={summarizeReasons(item)} />
                </td>
                <td>
                  <CoverageActionCell
                    item={item}
                    pending={pending}
                    refreshing={refreshing}
                    actioningElsewhere={actioningKey !== null && !pending}
                    mutationError={mutationErrorByKey[key]}
                    refreshError={refreshErrorByKey[key]}
                    onAction={handleAnalyze}
                    onRefreshRetry={handleRefreshRetry}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataState>
  );
}
