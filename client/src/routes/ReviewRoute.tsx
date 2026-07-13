import { useNavigate, useLocation, useParams } from "react-router-dom";
import { PrimaryButton } from "../components/PrimaryButton.js";
import { EmptyState } from "../components/EmptyState.js";
import { type FocusQueueRow } from "../lib/api.js";
import { ROUTES } from "../lib/routes.js";
import {
  collectQueueRows,
  resolveReviewNavigationItem,
  resolveReviewRoute,
} from "../lib/review-route.js";
import { useQueueQuery } from "../hooks/useQueueQuery.js";
import { Workbench } from "./Workbench.js";

export function ReviewRoute() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationItem = (location.state as { item?: FocusQueueRow } | null)
    ?.item;
  const { data: queueData, surface } = useQueueQuery();

  const immediateItem =
    jobId === undefined
      ? null
      : resolveReviewNavigationItem(jobId, navigationItem);

  const queueRows =
    immediateItem || queueData === undefined
      ? undefined
      : collectQueueRows(queueData);
  const queueError = !immediateItem && surface.showError;

  const onBack = () => navigate(ROUTES.inbox);

  if (!jobId) {
    return (
      <EmptyState
        title="Review is not available"
        body="This review link is missing a job id."
        action={
          <PrimaryButton quiet type="button" onClick={onBack}>
            Back to Inbox
          </PrimaryButton>
        }
      />
    );
  }

  if (immediateItem) {
    return <Workbench item={immediateItem} onBack={onBack} />;
  }

  if (queueRows === undefined && !queueError) {
    return <p className="reason-line">Loading review…</p>;
  }

  const resolution = resolveReviewRoute({
    jobId,
    queueRows,
    queueError,
  });

  if (resolution.kind === "queue") {
    return <Workbench item={resolution.item} onBack={onBack} />;
  }

  if (resolution.kind === "load-error") {
    return (
      <EmptyState
        title="Could not load review"
        body="Control Tower could not load queue context for this review link."
        action={
          <PrimaryButton quiet type="button" onClick={onBack}>
            Back to Inbox
          </PrimaryButton>
        }
      />
    );
  }

  return (
    <EmptyState
      title="Review context unavailable"
      body="This job is not in the current queue. Open it from Inbox or start analysis there."
      action={
        <PrimaryButton quiet type="button" onClick={onBack}>
          Back to Inbox
        </PrimaryButton>
      }
    />
  );
}
