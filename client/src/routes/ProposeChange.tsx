import { useState, useEffect } from "react";
import {
  api,
  type LearningSignalSummary,
  type ProposalDetail,
  type ProposalValidationResult,
  type ProposalAdoptionResult,
} from "../lib/api.js";
import { PrimaryButton } from "../components/PrimaryButton.js";

export function ProposeChange() {
  const [signals, setSignals] = useState<LearningSignalSummary[]>([]);
  const [selectedSignals, setSelectedSignals] = useState<Set<string>>(new Set());
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [validation, setValidation] = useState<ProposalValidationResult | null>(
    null,
  );
  const [adoptionResult, setAdoptionResult] =
    useState<ProposalAdoptionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSignals(50)
      .then(setSignals)
      .catch(() => setSignals([]));
  }, []);

  function toggleSignal(runId: string) {
    setSelectedSignals((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  async function startProposal() {
    if (selectedSignals.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.startProposal([...selectedSignals]);
      setProposal(data);
      setValidation(null);
      setAdoptionResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start proposal");
    } finally {
      setLoading(false);
    }
  }

  async function validateProposal() {
    if (!proposal) return;
    setError(null);
    try {
      setValidation(await api.validateProposal(proposal.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    }
  }

  async function adoptProposal() {
    if (!proposal) return;
    setError(null);
    try {
      setAdoptionResult(await api.adoptProposal(proposal.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adoption failed");
    }
  }

  return (
    <div className="proposal-page">
      <header className="page-heading">
        <h1>Propose Profile Change</h1>
      </header>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <section className="proposal-section">
        <h2>1. Select Learning Signals</h2>
        <p className="muted">
          Select historical signals to inform the proposal agent (max 50 runs, 2
          MiB).
        </p>
        <ul className="proposal-list">
          {signals.map((s) => (
            <li key={s.runId} className="proposal-list__item">
              <label>
                <input
                  type="checkbox"
                  checked={selectedSignals.has(s.runId)}
                  onChange={() => toggleSignal(s.runId)}
                />
                <span className="mono">
                  {s.type} — {s.modelRole} — {s.timestamp}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <PrimaryButton
          type="button"
          onClick={() => void startProposal()}
          disabled={selectedSignals.size === 0 || loading}
        >
          {loading ? "Generating..." : "Start Proposal"}
        </PrimaryButton>
      </section>

      {proposal && (
        <section className="proposal-section">
          <h2>2. Review Proposal</h2>
          <div className="proposal-card">
            <p>
              Status: <strong>{proposal.status}</strong>
            </p>
            {proposal.targets.map((t, i) => (
              <div key={i} className="proposal-card__target">
                <p className="mono">{t.path}</p>
                <p className="muted">{t.rationale}</p>
                <pre className="proposal-preview">{t.proposedContent}</pre>
              </div>
            ))}
          </div>
          <PrimaryButton type="button" onClick={() => void validateProposal()}>
            Validate
          </PrimaryButton>
        </section>
      )}

      {validation && (
        <section className="proposal-section">
          <h2>3. Validation Result</h2>
          {validation.valid ? (
            <p className="success-message">Validation passed</p>
          ) : (
            <ul className="error-message">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {validation.previews && validation.previews.length > 0 && (
            <div className="proposal-previews">
              <h3>Line-by-line preview</h3>
              {validation.previews.map((preview) => (
                <div key={preview.targetPath} className="proposal-card">
                  <p className="mono">{preview.targetPath}</p>
                  <pre className="proposal-preview">
                    {preview.lines.map((line, i) => (
                      <div
                        key={`${preview.targetPath}-${i}`}
                        className={
                          line.type === "added"
                            ? "preview-line preview-line--added"
                            : line.type === "removed"
                              ? "preview-line preview-line--removed"
                              : "preview-line"
                        }
                      >
                        {`${String(line.lineNumber).padStart(4, " ")} ${line.type === "added" ? "+" : line.type === "removed" ? "-" : " "} ${line.content}`}
                      </div>
                    ))}
                  </pre>
                </div>
              ))}
            </div>
          )}
          {validation.valid && (
            <PrimaryButton type="button" onClick={() => void adoptProposal()}>
              Adopt (single-use)
            </PrimaryButton>
          )}
        </section>
      )}

      {adoptionResult && (
        <section className="proposal-section">
          <h2>4. Adoption Result</h2>
          {adoptionResult.adopted ? (
            <p className="success-message">Adopted successfully</p>
          ) : (
            <ul className="error-message">
              {adoptionResult.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
