// client/src/routes/Workbench.tsx
import { useState, useCallback, useEffect } from "react";
import {
  type FocusQueueRow,
  type PublishResult,
  type CoverageInfo,
} from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { SafeMarkdown } from "../components/SafeMarkdown.js";
import { CoverageWarning } from "../components/CoverageWarning.js";
import { AdvisorNote } from "../components/AdvisorNote.js";
import { ReviewEvidenceSection } from "../components/ReviewEvidenceSection.js";
import { ActionButton } from "../components/ActionButton.js";
import { DataState } from "../components/DataState.js";
import { EmptyState } from "../components/EmptyState.js";
import { Tabs } from "../components/Tabs.js";
import { getReviewFallback } from "../lib/review-fallback.js";
import { formatRepositoryPr } from "../lib/repository-display.js";
import { useDraftQuery } from "../hooks/useDraftQuery.js";
import {
  useAnalyzeMutation,
  useRetryMutation,
} from "../hooks/useJobMutations.js";
import {
  useApproveMutation,
  usePublishMutation,
} from "../hooks/usePublicationMutations.js";

type Tab = "understand" | "verify" | "act";
type Disposition = "comment" | "request_changes" | "approve";

function countCoverageLimitations(coverage: CoverageInfo): number {
  let count = 0;
  if (!coverage.sourceTreeInspected) count += 1;
  count += coverage.missingCoverage.length;
  count += coverage.omittedProtectedPaths.length;
  if (!coverage.diffFiltered) count += 1;
  return count;
}

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
  return (
    <header className="review-header">
      <div>
        <ActionButton quiet type="button" onClick={onBack}>
          ← Inbox
        </ActionButton>
        <p>
          <code>
            <SafeText
              text={formatRepositoryPr(item.repository, item.prNumber)}
            />
          </code>
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
  const { surface } = useDraftQuery(jobId);
  const draft = surface.displayData ?? null;
  const loading = surface.isLoading;
  const analyzeMutation = useAnalyzeMutation();
  const retryMutation = useRetryMutation();
  const approveMutation = useApproveMutation(jobId);
  const publishMutation = usePublishMutation(jobId);
  const [tab, setTab] = useState<Tab>("understand");
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const [publishSummary, setPublishSummary] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PublishResult[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (
      draft?.recommendedDisposition &&
      draft.recommendedDisposition !== "needs_human"
    ) {
      setDisposition(draft.recommendedDisposition as Disposition);
    }
  }, [draft?.recommendedDisposition]);

  const handleApproveAndPublish = useCallback(
    async (opHash: string, body: string | null) => {
      setPublishing(true);
      try {
        await approveMutation.mutateAsync(opHash);
        const result = await publishMutation.mutateAsync({
          operationHash: opHash,
          body,
        });
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
    [approveMutation, publishMutation],
  );

  const handleRetry = useCallback(async () => {
    if (jobId === null) return;
    setRetrying(true);
    try {
      const { runId } = await retryMutation.mutateAsync(jobId);
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
  }, [jobId, retryMutation]);

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
        await retryMutation.mutateAsync(item.jobId);
      } else {
        await analyzeMutation.mutateAsync({
          repositoryKey: item.repositoryKey,
          prNumber: item.prNumber,
        });
      }
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecovering(false);
    }
  }, [analyzeMutation, item, retryMutation]);

  if (loading) {
    return (
      <section className="review-page">
        <ReviewChrome item={item} onBack={onBack} />
        <DataState
          isLoading
          showError={false}
          isStale={false}
          loadingMessage="Loading draft…"
        />
      </section>
    );
  }

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
              <ActionButton
                type="button"
                onClick={() => void handleFallback()}
                busy={recovering}
                busyLabel="Starting…"
              >
                {fallback.label}
              </ActionButton>
              <ActionButton quiet type="button" onClick={onBack}>
                Back to Inbox
              </ActionButton>
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

      <Tabs
        tabs={[
          { id: "understand", label: "Understand" },
          { id: "verify", label: "Verify" },
          { id: "act", label: "Act" },
        ]}
        active={tab}
        onChange={setTab}
        ariaLabel="Review tabs"
        tabIdPrefix="review-tab"
        panelIdPrefix="review-panel"
      />

      {tab === "understand" && (
        <section
          role="tabpanel"
          id="review-panel-understand"
          aria-labelledby="review-tab-understand"
          className="review-panel"
        >
          <div className="review-section">
            <h3 className="review-section__title">Intent</h3>
            <SafeText
              text={draft.summary.intent}
              as="p"
              className="review-section__body"
            />
          </div>
          <div className="review-section">
            <h3 className="review-section__title">Implementation</h3>
            <SafeText
              text={draft.summary.implementation}
              as="p"
              className="review-section__body"
            />
          </div>
          <ReviewEvidenceSection title="Checks" count={draft.checks.length}>
            {draft.checks.length === 0 ? (
              <p className="muted">No check results</p>
            ) : (
              <ul>
                {draft.checks.map((c, i) => (
                  <li key={i}>
                    <SafeText text={`${c.name}: ${c.status}`} />
                    {c.provenanceRef && (
                      <div className="muted provenance">
                        Provenance: <SafeText text={c.provenanceRef} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ReviewEvidenceSection>
          <ReviewEvidenceSection title="Unknowns" count={draft.unknowns.length}>
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
          </ReviewEvidenceSection>
          <ReviewEvidenceSection
            title="Coverage & limitations"
            count={countCoverageLimitations(draft.coverage)}
          >
            <ul>
              <li>
                Mode: <SafeText text={draft.coverage.mode} />
              </li>
              <li>
                Source tree inspected:{" "}
                {draft.coverage.sourceTreeInspected ? "yes" : "no"}
              </li>
              <li>
                Diff filtered: {draft.coverage.diffFiltered ? "yes" : "no"}
              </li>
              {draft.coverage.missingCoverage.length > 0 && (
                <li>
                  Missing coverage:{" "}
                  <SafeText text={draft.coverage.missingCoverage.join(", ")} />
                </li>
              )}
              {draft.coverage.omittedProtectedPaths.length > 0 && (
                <li>
                  Protected paths omitted:{" "}
                  <SafeText
                    text={draft.coverage.omittedProtectedPaths.join(", ")}
                  />
                </li>
              )}
            </ul>
          </ReviewEvidenceSection>
        </section>
      )}

      {tab === "verify" && (
        <section
          role="tabpanel"
          id="review-panel-verify"
          aria-labelledby="review-tab-verify"
          className="review-panel"
        >
          <ReviewEvidenceSection
            title="Observations"
            count={draft.observations.length}
          >
            {draft.observations.length === 0 ? (
              <p className="muted">No observations</p>
            ) : (
              draft.observations.map((obs, i) => (
                <div key={i} className="review-card">
                  <span
                    className={`observation-type observation-type--${obs.type}`}
                  >
                    {obs.type}
                  </span>
                  <SafeText text={obs.statement} as="p" />
                  <div className="muted provenance">
                    Provenance:{" "}
                    <SafeText
                      text={obs.provenanceRefs.join(", ") || "none"}
                    />
                  </div>
                </div>
              ))
            )}
          </ReviewEvidenceSection>
          <div className="review-section">
            <h3 className="review-section__title">
              Findings ({draft.findings.length})
            </h3>
            {draft.findings.map((f, i) => (
              <div
                key={i}
                className={`finding finding--${f.severity === "blocking" ? "blocking" : f.severity === "high" ? "high" : "other"}`}
              >
                <div className="finding__header">
                  <strong>
                    <SafeText text={f.title} />
                  </strong>
                </div>
                <dl className="finding__meta">
                  <div className="finding__meta-item">
                    <dt>Severity</dt>
                    <dd>
                      <SafeText text={f.severity} />
                    </dd>
                  </div>
                  <div className="finding__meta-item">
                    <dt>Confidence</dt>
                    <dd>
                      <SafeText text={f.confidence} />
                    </dd>
                  </div>
                  {f.file && (
                    <div className="finding__meta-item">
                      <dt>Source</dt>
                      <dd>
                        <code>
                          <SafeText text={f.file} />
                          {f.location && `:${f.location.line}`}
                        </code>
                      </dd>
                    </div>
                  )}
                </dl>
                <SafeText text={f.rationale} as="p" />
              </div>
            ))}
          </div>
          <ReviewEvidenceSection
            title="Provenance"
            count={draft.validatedProvenance.length}
          >
            {draft.validatedProvenance.length === 0 ? (
              <p className="muted">No validated provenance records</p>
            ) : (
              <ul>
                {draft.validatedProvenance.map((entry, i) => (
                  <li key={i}>
                    <SafeText text={JSON.stringify(entry)} />
                  </li>
                ))}
              </ul>
            )}
          </ReviewEvidenceSection>
        </section>
      )}

      {tab === "act" && (
        <section
          role="tabpanel"
          id="review-panel-act"
          aria-labelledby="review-tab-act"
        >
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
            <ActionButton
              quiet
              type="button"
              disabled={retrying || jobId === null}
              busy={retrying}
              busyLabel="Retrying…"
              onClick={() => void handleRetry()}
            >
              Retry Analysis
            </ActionButton>
          </div>

          {!isNeedsHuman && (
            <>
              <h3>Disposition</h3>
              <div className="button-group">
                {(["comment", "request_changes", "approve"] as Disposition[]).map(
                  (d) => (
                    <ActionButton
                      key={d}
                      quiet={disposition !== d}
                      type="button"
                      onClick={() => setDisposition(d)}
                    >
                      {d.replace(/_/g, " ")}
                    </ActionButton>
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
                      <ActionButton
                        type="button"
                        busy={publishing}
                        busyLabel="Publishing…"
                        disabled={publishing}
                        onClick={() =>
                          void handleApproveAndPublish(op.operationHash, null)
                        }
                      >
                        Approve & Publish
                      </ActionButton>
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
