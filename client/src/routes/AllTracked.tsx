import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TrackedQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { ReasonLine } from "../components/ReasonLine.js";
import { PrimaryButton } from "../components/PrimaryButton.js";
import { StatusChip } from "../components/StatusChip.js";
import { EmptyState } from "../components/EmptyState.js";
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

function formatRepoPr(item: TrackedQueueRow): string {
  const repoName = item.repository.split("/").at(-1) ?? item.repository;
  return `${repoName}#${item.prNumber}`;
}

function formatPriority(priority: string): string {
  if (priority === "unranked") return "Unranked — ineligible";
  return priority.toUpperCase();
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
        <PrimaryButton disabled>Working…</PrimaryButton>
      ) : refreshError ? (
        <>
          {analyzing && <StatusChip status="analyzing" />}
          <PrimaryButton
            quiet
            disabled={refreshing}
            onClick={() => onRefreshRetry(item)}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </PrimaryButton>
        </>
      ) : analyzing ? (
        <StatusChip status="analyzing" />
      ) : (
        <PrimaryButton
          disabled={actioningElsewhere}
          onClick={() => onAction(item)}
        >
          {actionLabel}
        </PrimaryButton>
      )}
    </>
  );
}

export function AllTracked() {
  const [items, setItems] = useState<TrackedQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    const data = await api.getQueue();
    setItems(data.allTracked);
  }, []);

  useEffect(() => {
    refetchQueue()
      .then(() => setLoading(false))
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [refetchQueue]);

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
        const { jobId } = await api.requestAnalyze({
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
    [actioningKey, clearRowFeedback, refreshAfterMutation],
  );

  if (loading) {
    return <p className="reason-line">Loading coverage…</p>;
  }

  if (loadError !== null) {
    return (
      <EmptyState
        title="Could not load coverage"
        body={loadError}
        action={
          <PrimaryButton
            onClick={() => {
              setLoading(true);
              void refetchQueue()
                .then(() => {
                  setLoadError(null);
                  setLoading(false);
                })
                .catch((err: unknown) => {
                  setLoadError(
                    err instanceof Error ? err.message : String(err),
                  );
                  setLoading(false);
                });
            }}
          >
            Retry
          </PrimaryButton>
        }
      />
    );
  }

  return (
    <div>
      <h2 className="page-heading">Coverage</h2>

      <div className="coverage-controls">
        <PrimaryButton
          quiet={filter !== "eligible"}
          aria-pressed={filter === "eligible"}
          onClick={() => setFilter("eligible")}
        >
          Eligible
        </PrimaryButton>
        <PrimaryButton
          quiet={filter !== "ineligible"}
          aria-pressed={filter === "ineligible"}
          onClick={() => setFilter("ineligible")}
        >
          Ineligible
        </PrimaryButton>
        <PrimaryButton
          quiet={filter !== "all"}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All
        </PrimaryButton>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search coverage"
          placeholder="Search PR, title, or author"
        />
      </div>

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
                  <SafeText text={formatPriority(item.priority)} />
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
    </div>
  );
}
