import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type FocusQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { AdvisorNote } from "../components/AdvisorNote.js";
import { ReasonLine } from "../components/ReasonLine.js";
import { ActionButton } from "../components/ActionButton.js";
import { DataState } from "../components/DataState.js";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import { PriorityIndicator } from "../components/PriorityIndicator.js";
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
import { queryKeys } from "../lib/query-keys.js";
import { useAnalyzeMutation, useRetryMutation } from "../hooks/useJobMutations.js";
import { useQueueQuery } from "../hooks/useQueueQuery.js";

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
                <PriorityIndicator priority={item.priority} />
              </>
            )}
            {hasExplicitRequest && " · Explicit request"}
          </div>
          <AdvisorNote result={item.advisorResult} />
          <ReasonLine text={summarizeReasons(item)} />
          {mutationError && <ReasonLine text={mutationError} />}
          {refreshError && <ReasonLine text={refreshError} />}
        </div>
        <StatusBadge status={presentation.chip} />
        {presentation.primaryAction !== null ? (
          <ActionButton
            disabled={actioningKey !== null && !pending}
            busy={pending}
            busyLabel="Working…"
            onClick={() => onAction(item)}
          >
            {actionLabel(presentation.primaryAction)}
          </ActionButton>
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
  const queryClient = useQueryClient();
  const { focusQueue, surface, refetch } = useQueueQuery();
  const analyzeMutation = useAnalyzeMutation();
  const retryMutation = useRetryMutation();
  const queue = focusQueue ?? { now: [], next: [], monitor: [] };
  const loading = surface.isLoading;
  const loadError = surface.showError
    ? (surface.error?.message ?? "Failed to load inbox")
    : null;
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
    const result = await refetch();
    if (result.isError) {
      throw result.error;
    }
    return result.data?.focusQueue;
  }, [refetch]);

  const applyPatches = useCallback(
    (items: FocusQueueRow[]) =>
      items.map((item) => mergeRowPatch(item, rowPatches)),
    [rowPatches],
  );

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
        } else if (action === "retry") {
          if (item.jobId === null) {
            throw new Error("No job available to retry.");
          }
          await retryMutation.mutateAsync(item.jobId);
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
          await queryClient.fetchQuery({
            queryKey: queryKeys.draft(item.jobId),
            queryFn: () => api.getDraft(item.jobId!),
          });
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
    [actioningKey, analyzeMutation, clearRowFeedback, onOpenReview, queryClient, refreshAfterMutation, retryMutation],
  );

  return (
    <DataState
      isLoading={loading}
      showError={loadError !== null}
      isStale={surface.isStale}
      loadingMessage="Loading inbox…"
      errorTitle="Could not load inbox"
      errorMessage={loadError ?? "Failed to load inbox"}
      onRetry={() => {
        void refetch();
      }}
    >
      <PageHeader
        title="Inbox"
        subtitle={`${actionableCount} items need attention · ordered by advisor relevance & risk`}
      />
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
    </DataState>
  );
}
