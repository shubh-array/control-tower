import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type FocusQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { StatusChip } from "../components/StatusChip.js";
import { AdvisorNote } from "../components/AdvisorNote.js";
import { ReasonLine } from "../components/ReasonLine.js";
import { PrimaryButton } from "../components/PrimaryButton.js";
import { EmptyState } from "../components/EmptyState.js";
import {
  INBOX_REFRESH_ERROR,
  inboxRowKey,
  mergeRowPatch,
  patchRowAfterMutation,
  patchRowAfterRetry,
} from "../lib/inbox-resilience.js";
import {
  deriveInboxPresentation,
  sortInboxRows,
  summarizeReasons,
} from "../lib/queue-display.js";

const DRAFT_UNAVAILABLE_MESSAGE =
  "Draft is not available yet. Retry analysis or refresh the Inbox.";

function formatRepoPr(item: FocusQueueRow): string {
  const repoName = item.repository.split("/").at(-1) ?? item.repository;
  return `${repoName}#${item.prNumber}`;
}

function actionLabel(action: "analyze" | "open-review" | "retry"): string {
  if (action === "analyze") return "Analyze";
  if (action === "open-review") return "Open Review";
  return "Retry";
}

function InboxRow({
  item,
  actioningKey,
  mutationError,
  refreshError,
  onAction,
}: {
  item: FocusQueueRow;
  actioningKey: string | null;
  mutationError: string | undefined;
  refreshError: string | undefined;
  onAction: (item: FocusQueueRow) => void;
}) {
  const key = inboxRowKey(item);
  const presentation = deriveInboxPresentation(item);
  const pending = actioningKey === key;
  const hasExplicitRequest = item.eligibilityReasons.some(
    (reason) => reason.code === "explicit_review_request",
  );

  return (
    <li>
      <article className="inbox-row">
        <div>
          <div className="inbox-row__meta">
            <code>
              <SafeText text={formatRepoPr(item)} />
            </code>
            <SafeText text={item.title} />
          </div>
          <div className="inbox-row__meta">
            <SafeText text={item.author} />
            {item.priority !== "unranked" && (
              <>
                {" · "}
                {item.priority.toUpperCase()}
              </>
            )}
            {hasExplicitRequest && " · Explicit request"}
          </div>
          <AdvisorNote result={item.advisorResult} />
          <ReasonLine text={summarizeReasons(item)} />
          {mutationError && <ReasonLine text={mutationError} />}
          {refreshError && <ReasonLine text={refreshError} />}
        </div>
        <StatusChip status={presentation.chip} />
        {presentation.primaryAction !== null ? (
          <PrimaryButton
            disabled={pending || actioningKey !== null}
            onClick={() => onAction(item)}
          >
            {pending ? "Working…" : actionLabel(presentation.primaryAction)}
          </PrimaryButton>
        ) : (
          <span />
        )}
      </article>
    </li>
  );
}

function InboxList({
  items,
  actioningKey,
  mutationErrorByKey,
  refreshErrorByKey,
  onAction,
  showEmptyState = false,
}: {
  items: FocusQueueRow[];
  actioningKey: string | null;
  mutationErrorByKey: Record<string, string>;
  refreshErrorByKey: Record<string, string>;
  onAction: (item: FocusQueueRow) => void;
  showEmptyState?: boolean;
}) {
  if (items.length === 0) {
    if (showEmptyState) {
      return (
        <EmptyState
          title="Inbox is clear"
          body="No pull requests need attention right now."
        />
      );
    }
    return <p className="reason-line">No items in this lane.</p>;
  }

  return (
    <ul className="inbox-list">
      {items.map((item) => {
        const key = inboxRowKey(item);
        return (
          <InboxRow
            key={key}
            item={item}
            actioningKey={actioningKey}
            mutationError={mutationErrorByKey[key]}
            refreshError={refreshErrorByKey[key]}
            onAction={onAction}
          />
        );
      })}
    </ul>
  );
}

export function FocusQueue({
  onOpenReview,
}: {
  onOpenReview: (item: FocusQueueRow) => void;
}) {
  const [queue, setQueue] = useState<{
    now: FocusQueueRow[];
    next: FocusQueueRow[];
    monitor: FocusQueueRow[];
  }>({ now: [], next: [], monitor: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupByLane, setGroupByLane] = useState(false);
  const [actioningKey, setActioningKey] = useState<string | null>(null);
  const [rowPatches, setRowPatches] = useState<
    Record<string, Partial<FocusQueueRow>>
  >({});
  const [mutationErrorByKey, setMutationErrorByKey] = useState<
    Record<string, string>
  >({});
  const [refreshErrorByKey, setRefreshErrorByKey] = useState<
    Record<string, string>
  >({});

  const refetchQueue = useCallback(async () => {
    const data = await api.getQueue();
    setQueue(data.focusQueue);
    return data.focusQueue;
  }, []);

  const applyPatches = useCallback(
    (items: FocusQueueRow[]) =>
      items.map((item) => mergeRowPatch(item, rowPatches)),
    [rowPatches],
  );

  useEffect(() => {
    refetchQueue()
      .then(() => {
        setLoadError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [refetchQueue]);

  const flatItems = useMemo(
    () =>
      applyPatches(
        sortInboxRows([...queue.now, ...queue.next, ...queue.monitor]),
      ),
    [applyPatches, queue],
  );

  const groupedItems = useMemo(
    () => ({
      now: applyPatches(sortInboxRows(queue.now)),
      next: applyPatches(sortInboxRows(queue.next)),
      monitor: applyPatches(sortInboxRows(queue.monitor)),
    }),
    [applyPatches, queue],
  );

  const actionableCount = useMemo(
    () =>
      flatItems.filter(
        (item) => deriveInboxPresentation(item).primaryAction !== null,
      ).length,
    [flatItems],
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

  const handleAction = useCallback(
    async (item: FocusQueueRow) => {
      const key = inboxRowKey(item);
      const presentation = deriveInboxPresentation(item);
      const action = presentation.primaryAction;
      if (action === null || actioningKey !== null) return;

      setActioningKey(key);
      clearRowFeedback(key);

      try {
        if (action === "analyze") {
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
        } else if (action === "retry") {
          if (item.jobId === null) {
            throw new Error("No job available to retry.");
          }
          await api.requestRetry(item.jobId);
          const patched = patchRowAfterRetry(item);
          setRowPatches((prev) => ({
            ...prev,
            [key]: { jobState: patched.jobState },
          }));
          await refreshAfterMutation(key);
        } else if (action === "open-review") {
          if (item.jobId === null) {
            throw new Error(DRAFT_UNAVAILABLE_MESSAGE);
          }
          await api.getDraft(item.jobId);
          onOpenReview(item);
        }
      } catch (err: unknown) {
        const message =
          action === "open-review"
            ? DRAFT_UNAVAILABLE_MESSAGE
            : err instanceof Error
              ? err.message
              : String(err);
        setMutationErrorByKey((prev) => ({ ...prev, [key]: message }));
      } finally {
        setActioningKey(null);
      }
    },
    [actioningKey, clearRowFeedback, onOpenReview, refreshAfterMutation],
  );

  if (loading) {
    return <p className="reason-line">Loading inbox…</p>;
  }

  if (loadError !== null) {
    return (
      <EmptyState
        title="Could not load inbox"
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
                  setLoadError(err instanceof Error ? err.message : String(err));
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
      <h2 className="page-heading">Inbox</h2>
      <p className="reason-line">
        {`${actionableCount} items need attention · ordered by advisor relevance & risk`}
      </p>
      <label className="reason-line">
        <input
          type="checkbox"
          checked={groupByLane}
          onChange={(event) => setGroupByLane(event.target.checked)}
        />{" "}
        Group by lane
      </label>

      {groupByLane ? (
        <>
          <h3 className="page-heading">Now</h3>
          <InboxList
            items={groupedItems.now}
            actioningKey={actioningKey}
            mutationErrorByKey={mutationErrorByKey}
            refreshErrorByKey={refreshErrorByKey}
            onAction={handleAction}
          />
          <h3 className="page-heading">Next</h3>
          <InboxList
            items={groupedItems.next}
            actioningKey={actioningKey}
            mutationErrorByKey={mutationErrorByKey}
            refreshErrorByKey={refreshErrorByKey}
            onAction={handleAction}
          />
          <h3 className="page-heading">Monitor</h3>
          <InboxList
            items={groupedItems.monitor}
            actioningKey={actioningKey}
            mutationErrorByKey={mutationErrorByKey}
            refreshErrorByKey={refreshErrorByKey}
            onAction={handleAction}
          />
        </>
      ) : (
        <InboxList
          items={flatItems}
          actioningKey={actioningKey}
          mutationErrorByKey={mutationErrorByKey}
          refreshErrorByKey={refreshErrorByKey}
          onAction={handleAction}
          showEmptyState
        />
      )}
    </div>
  );
}
