// client/src/routes/Workbench.tsx
import { useEffect, useState, useCallback } from "react";
import { api, type DraftDetail, type PublishResult } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { SafeMarkdown } from "../components/SafeMarkdown.js";
import { CoverageWarning } from "../components/CoverageWarning.js";

type Tab = "understand" | "verify" | "act";
type Disposition = "comment" | "request_changes" | "approve";

interface WorkbenchProps {
  jobId: string;
  onBack: () => void;
}

export function Workbench({ jobId, onBack }: WorkbenchProps) {
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("understand");
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const [publishSummary, setPublishSummary] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PublishResult[]>([]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    api.getDraft(jobId).then((d) => {
      setDraft(d);
      setLoading(false);
      if (d.recommendedDisposition !== "needs_human") {
        setDisposition(d.recommendedDisposition as Disposition);
      }
    }).catch(() => setLoading(false));
  }, [jobId]);

  const handleApproveAndPublish = useCallback(async (opHash: string, body: string | null) => {
    setPublishing(true);
    try {
      await api.approveOperation(opHash);
      const result = await api.publishOperation(opHash, body);
      setResults((prev) => [...prev, result]);
    } catch (err) {
      setResults((prev) => [
        ...prev,
        { status: "failed", error: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setPublishing(false);
    }
  }, []);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const { runId } = await api.requestRetry(jobId);
      setResults((prev) => [
        ...prev,
        { status: "completed", error: undefined },
      ]);
      console.log(`Retry started: runId=${runId}`);
    } catch (err) {
      setResults((prev) => [
        ...prev,
        { status: "failed", error: `Retry failed: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setRetrying(false);
    }
  }, [jobId]);

  if (loading) return <p>Loading draft…</p>;
  if (!draft) return <p>No draft available for this job.</p>;

  const isNeedsHuman = draft.recommendedDisposition === "needs_human";

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
      <button onClick={onBack} style={{ marginBottom: "12px", cursor: "pointer" }}>
        ← Back to queue
      </button>

      <CoverageWarning coverage={draft.coverage} />

      <nav style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "2px solid #e5e7eb", paddingBottom: "8px" }}>
        {(["understand", "verify", "act"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              border: "none",
              borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent",
              background: "none",
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
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
            <p style={{ color: "#6b7280" }}>No check results</p>
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
            <p style={{ color: "#6b7280" }}>None reported</p>
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
            <div
              key={i}
              style={{
                padding: "8px",
                marginBottom: "8px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  color: obs.type === "observation" ? "#16a34a" : "#ca8a04",
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                {obs.type}
              </span>
              <SafeText text={obs.statement} as="p" />
              <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                Provenance: {obs.provenanceRefs.join(", ") || "none"}
              </div>
            </div>
          ))}
          <h3>Findings ({draft.findings.length})</h3>
          {draft.findings.map((f, i) => (
            <div
              key={i}
              style={{
                padding: "8px 12px",
                marginBottom: "8px",
                borderLeft: `3px solid ${f.severity === "blocking" ? "#dc2626" : f.severity === "high" ? "#ea580c" : "#ca8a04"}`,
                backgroundColor: "#fafafa",
                borderRadius: "0 6px 6px 0",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>
                  <SafeText text={f.title} />
                </strong>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {f.severity} · {f.confidence} confidence
                </span>
              </div>
              <SafeText text={f.rationale} as="p" />
              {f.file && (
                <code style={{ fontSize: "0.8rem" }}>
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
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              marginBottom: "16px",
              backgroundColor: "#f9fafb",
            }}
          >
            <SafeMarkdown content={draft.draftSummary.body} />
          </div>

          {isNeedsHuman && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#fee2e2",
                border: "1px solid #fca5a5",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              <strong>needs_human</strong> — This draft requires manual handling and cannot be published.
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button
              disabled={retrying}
              onClick={handleRetry}
              style={{
                padding: "6px 16px",
                fontSize: "0.875rem",
                border: "1px solid #d97706",
                borderRadius: "6px",
                backgroundColor: "#fff",
                color: "#d97706",
                cursor: retrying ? "wait" : "pointer",
                opacity: retrying ? 0.6 : 1,
              }}
            >
              {retrying ? "Retrying…" : "Retry Analysis"}
            </button>
          </div>

          {!isNeedsHuman && (
            <>
              <h3>Disposition</h3>
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                {(["comment", "request_changes", "approve"] as Disposition[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDisposition(d)}
                    style={{
                      padding: "8px 16px",
                      border: disposition === d ? "2px solid #2563eb" : "1px solid #d1d5db",
                      borderRadius: "6px",
                      backgroundColor: disposition === d ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                      fontWeight: disposition === d ? 600 : 400,
                    }}
                  >
                    {d.replace(/_/g, " ")}
                  </button>
                ))}
              </div>

              {disposition === "approve" && (
                <label style={{ display: "block", marginBottom: "16px", fontSize: "0.875rem" }}>
                  <input
                    type="checkbox"
                    checked={publishSummary}
                    onChange={(e) => setPublishSummary(e.target.checked)}
                    style={{ marginRight: "6px" }}
                  />
                  Publish summary as a separate comment
                </label>
              )}

              {draft.operationPlan && (
                <>
                  <h3>Operations Preview</h3>
                  <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "8px" }}>
                    Each operation requires separate approval. No batch approval.
                  </p>
                  {draft.operationPlan.operations.map((op, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        marginBottom: "4px",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                          {op.type.replace(/_/g, " ")}
                        </span>
                        {op.event && (
                          <span style={{ marginLeft: "8px", fontSize: "0.75rem", color: "#6b7280" }}>
                            ({op.event})
                          </span>
                        )}
                      </div>
                      <button
                        disabled={publishing}
                        onClick={() => handleApproveAndPublish(op.operationHash, null)}
                        style={{
                          padding: "4px 12px",
                          fontSize: "0.875rem",
                          border: "1px solid #2563eb",
                          borderRadius: "6px",
                          backgroundColor: "#2563eb",
                          color: "#fff",
                          cursor: publishing ? "wait" : "pointer",
                          opacity: publishing ? 0.6 : 1,
                        }}
                      >
                        Approve & Publish
                      </button>
                    </div>
                  ))}
                </>
              )}

              {results.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <h4>Publication Results</h4>
                  {results.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "6px 12px",
                        marginBottom: "4px",
                        borderRadius: "4px",
                        backgroundColor: r.status === "completed" ? "#dcfce7" : "#fee2e2",
                        fontSize: "0.875rem",
                      }}
                    >
                      {r.status === "completed" ? "✓ Published" : `✗ Failed: ${r.error}`}
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
