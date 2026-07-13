// client/src/routes/Workbench.tsx
import { useEffect, useState, useCallback } from "react";
import {
  api,
  type DraftDetail,
  type FocusQueueRow,
  type PublishResult,
} from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { SafeMarkdown } from "../components/SafeMarkdown.js";
import { CoverageWarning } from "../components/CoverageWarning.js";
import { AdvisorNote } from "../components/AdvisorNote.js";
import { PrimaryButton } from "../components/PrimaryButton.js";
import { EmptyState } from "../components/EmptyState.js";
import { getReviewFallback } from "../lib/review-fallback.js";

type Tab = "understand" | "verify" | "act";
type Disposition = "comment" | "request_changes" | "approve";

interface WorkbenchProps {
  item: FocusQueueRow;
  onBack: () => void;
}

function ReviewChrome({
  item,
  onBack,
}: {
  item: FocusQueueRow;
  onBack: () => void;
}) {
  const repoLabel = item.repository.split("/").at(-1) ?? item.repository;
  return (
    <header className="review-header">
      <div>
        <PrimaryButton quiet type="button" onClick={onBack}>
          ← Inbox
        </PrimaryButton>
        <p>
          <code>{`${repoLabel}#${item.prNumber}`}</code>
        </p>
        <h2>
          <SafeText text={item.title} />
        </h2>
        <p className="row-meta">
          <SafeText text={item.author} />
          {item.priority !== "unranked" ? ` · ${item.priority.toUpperCase()}` : ""}
        </p>
        <AdvisorNote result={item.advisorResult} />
      </div>
    </header>
  );
}

export function Workbench({ item, onBack }: WorkbenchProps) {
  const jobId = item.jobId;
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("understand");
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const [publishSummary, setPublishSummary] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PublishResult[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (jobId === null) {
      setDraft(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getDraft(jobId)
      .then((d) => {
        setDraft(d);
        setLoading(false);
        if (d.recommendedDisposition !== "needs_human") {
          setDisposition(d.recommendedDisposition as Disposition);
        }
      })
      .catch(() => {
        setDraft(null);
        setLoading(false);
      });
  }, [jobId]);

  const handleApproveAndPublish = useCallback(
    async (opHash: string, body: string | null) => {
      setPublishing(true);
      try {
        await api.approveOperation(opHash);
        const result = await api.publishOperation(opHash, body);
        setResults((prev) => [...prev, result]);
      } catch (err) {
        setResults((prev) => [
          ...prev,
          {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          },
        ]);
      } finally {
        setPublishing(false);
      }
    },
    [],
  );

  const handleRetry = useCallback(async () => {
    if (jobId === null) return;
    setRetrying(true);
    try {
      const { runId } = await api.requestRetry(jobId);
      setResults((prev) => [...prev, { status: "completed", error: undefined }]);
      console.log(`Retry started: runId=${runId}`);
    } catch (err) {
      setResults((prev) => [
        ...prev,
        {
          status: "failed",
          error: `Retry failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setRetrying(false);
    }
  }, [jobId]);

  const handleFallback = useCallback(async () => {
    const fallback = getReviewFallback({
      jobId: item.jobId,
      jobState: item.jobState,
    });
    setRecovering(true);
    setRecoveryError(null);
    try {
      if (fallback.action === "retry") {
        if (item.jobId === null) {
          throw new Error("No job available to retry");
        }
        await api.requestRetry(item.jobId);
      } else {
        await api.requestAnalyze({
          repositoryKey: item.repositoryKey,
          prNumber: item.prNumber,
        });
      }
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecovering(false);
    }
  }, [item]);

  if (loading) return <p>Loading draft…</p>;

  if (!draft) {
    const fallback = getReviewFallback({
      jobId: item.jobId,
      jobState: item.jobState,
    });
    return (
      <section className="review-page">
        <ReviewChrome item={item} onBack={onBack} />
        <EmptyState
          title="Review is not available"
          body={fallback.message}
          action={
            <div className="button-group">
              <PrimaryButton
                type="button"
                onClick={() => void handleFallback()}
                disabled={recovering}
              >
                {recovering ? "Starting…" : fallback.label}
              </PrimaryButton>
              <PrimaryButton quiet type="button" onClick={onBack}>
                Back to Inbox
              </PrimaryButton>
            </div>
          }
        />
        {recoveryError !== null && (
          <p className="error-message" role="alert">
            {recoveryError}
          </p>
        )}
      </section>
    );
  }

  const isNeedsHuman = draft.recommendedDisposition === "needs_human";

  return (
    <div className="review-page">
      <ReviewChrome item={item} onBack={onBack} />

      <CoverageWarning coverage={draft.coverage} />

      <nav className="review-tabs" aria-label="Review tabs">
        {(["understand", "verify", "act"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`review-tabs__tab${tab === t ? " review-tabs__tab--active" : ""}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "understand" && (
        <section>
          <h3>Intent</h3>
          <SafeText text={draft.summary.intent} as="p" />
          <h3>Implementation</h3>
          <SafeText text={draft.summary.implementation} as="p" />
          <h3>Checks ({draft.checks.length})</h3>
          {draft.checks.length === 0 ? (
            <p className="muted">No check results</p>
          ) : (
            <ul>
              {draft.checks.map((c, i) => (
                <li key={i}>
                  <SafeText text={`${c.name}: ${c.status}`} />
                </li>
              ))}
            </ul>
          )}
          <h3>Unknowns</h3>
          {draft.unknowns.length === 0 ? (
            <p className="muted">None reported</p>
          ) : (
            <ul>
              {draft.unknowns.map((u, i) => (
                <li key={i}>
                  <SafeText text={u} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "verify" && (
        <section>
          <h3>Observations ({draft.observations.length})</h3>
          {draft.observations.map((obs, i) => (
            <div key={i} className="review-card">
              <span className={`observation-type observation-type--${obs.type}`}>
                {obs.type}
              </span>
              <SafeText text={obs.statement} as="p" />
              <div className="muted provenance">
                Provenance: {obs.provenanceRefs.join(", ") || "none"}
              </div>
            </div>
          ))}
          <h3>Findings ({draft.findings.length})</h3>
          {draft.findings.map((f, i) => (
            <div
              key={i}
              className={`finding finding--${f.severity === "blocking" ? "blocking" : f.severity === "high" ? "high" : "other"}`}
            >
              <div className="finding__header">
                <strong>
                  <SafeText text={f.title} />
                </strong>
                <span className="muted">
                  {f.severity} · {f.confidence} confidence
                </span>
              </div>
              <SafeText text={f.rationale} as="p" />
              {f.file && (
                <code>
                  <SafeText text={f.file} />
                  {f.location && `:${f.location.line}`}
                </code>
              )}
            </div>
          ))}
        </section>
      )}

      {tab === "act" && (
        <section>
          <h3>Draft Summary</h3>
          <div className="review-card review-card--summary">
            <SafeMarkdown content={draft.draftSummary.body} />
          </div>

          {isNeedsHuman && (
            <div className="error-banner" role="alert">
              <strong>needs_human</strong> — This draft requires manual handling
              and cannot be published.
            </div>
          )}

          <div className="button-group">
            <PrimaryButton
              quiet
              type="button"
              disabled={retrying || jobId === null}
              onClick={() => void handleRetry()}
            >
              {retrying ? "Retrying…" : "Retry Analysis"}
            </PrimaryButton>
          </div>

          {!isNeedsHuman && (
            <>
              <h3>Disposition</h3>
              <div className="button-group">
                {(["comment", "request_changes", "approve"] as Disposition[]).map(
                  (d) => (
                    <PrimaryButton
                      key={d}
                      quiet={disposition !== d}
                      type="button"
                      onClick={() => setDisposition(d)}
                    >
                      {d.replace(/_/g, " ")}
                    </PrimaryButton>
                  ),
                )}
              </div>

              {disposition === "approve" && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={publishSummary}
                    onChange={(e) => setPublishSummary(e.target.checked)}
                  />
                  Publish summary as a separate comment
                </label>
              )}

              {draft.operationPlan && (
                <>
                  <h3>Operations Preview</h3>
                  <p className="muted">
                    Each operation requires separate approval. No batch approval.
                  </p>
                  {draft.operationPlan.operations.map((op, i) => (
                    <div key={i} className="operation-row">
                      <div>
                        <span className="operation-row__type">
                          {op.type.replace(/_/g, " ")}
                        </span>
                        {op.event && (
                          <span className="muted"> ({op.event})</span>
                        )}
                      </div>
                      <PrimaryButton
                        type="button"
                        disabled={publishing}
                        onClick={() =>
                          void handleApproveAndPublish(op.operationHash, null)
                        }
                      >
                        Approve & Publish
                      </PrimaryButton>
                    </div>
                  ))}
                </>
              )}

              {results.length > 0 && (
                <div className="publication-results">
                  <h4>Publication Results</h4>
                  {results.map((r, i) => (
                    <div
                      key={i}
                      className={
                        r.status === "completed"
                          ? "success-message"
                          : "error-message"
                      }
                      role={r.status === "failed" ? "alert" : undefined}
                    >
                      {r.status === "completed"
                        ? "✓ Published"
                        : `✗ Failed: ${r.error}`}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
