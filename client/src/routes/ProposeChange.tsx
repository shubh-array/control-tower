import { useState, useEffect } from 'react';

interface Signal {
  type: string;
  jobId: string;
  runId: string;
  timestamp: string;
  modelRole: string;
}

interface Proposal {
  id: string;
  status: string;
  targets: Array<{ path: string; rationale: string; proposedContent: string; baseContentHash: string }>;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface AdoptionResult {
  adopted: boolean;
  errors: string[];
}

export function ProposeChange() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedSignals, setSelectedSignals] = useState<Set<string>>(new Set());
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [adoptionResult, setAdoptionResult] = useState<AdoptionResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/signals?limit=50')
      .then(r => r.json())
      .then(setSignals)
      .catch(() => setSignals([]));
  }, []);

  function toggleSignal(runId: string) {
    setSelectedSignals(prev => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  async function startProposal() {
    if (selectedSignals.size === 0) return;
    setLoading(true);
    const resp = await fetch('/api/proposals/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signalRunIds: [...selectedSignals] }),
    });
    const data = await resp.json();
    setProposal(data);
    setLoading(false);
  }

  async function validateProposal() {
    if (!proposal) return;
    const resp = await fetch(`/api/proposals/${proposal.id}/validate`, { method: 'POST' });
    setValidation(await resp.json());
  }

  async function adoptProposal() {
    if (!proposal) return;
    const resp = await fetch(`/api/proposals/${proposal.id}/adopt`, { method: 'POST' });
    setAdoptionResult(await resp.json());
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Propose Profile Change</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">1. Select Learning Signals</h2>
        <p className="text-sm text-gray-600 mb-2">
          Select historical signals to inform the proposal agent (max 50 runs, 2 MiB).
        </p>
        <ul className="space-y-1 max-h-60 overflow-y-auto border rounded p-2">
          {signals.map(s => (
            <li key={s.runId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedSignals.has(s.runId)}
                onChange={() => toggleSignal(s.runId)}
              />
              <span className="text-sm font-mono">
                {s.type} — {s.modelRole} — {s.timestamp}
              </span>
            </li>
          ))}
        </ul>
        <button
          onClick={startProposal}
          disabled={selectedSignals.size === 0 || loading}
          className="mt-2 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {loading ? 'Generating...' : 'Start Proposal'}
        </button>
      </section>

      {proposal && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">2. Review Proposal</h2>
          <div className="border rounded p-4 bg-gray-50">
            <p className="text-sm mb-2">Status: <strong>{proposal.status}</strong></p>
            {proposal.targets.map((t, i) => (
              <div key={i} className="mb-3 border-b pb-2">
                <p className="font-mono text-sm">{t.path}</p>
                <p className="text-sm text-gray-700">{t.rationale}</p>
                <pre className="mt-1 text-xs bg-white border p-2 overflow-x-auto max-h-40">
                  {t.proposedContent}
                </pre>
              </div>
            ))}
          </div>
          <button onClick={validateProposal} className="mt-2 px-4 py-2 bg-green-600 text-white rounded">
            Validate
          </button>
        </section>
      )}

      {validation && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">3. Validation Result</h2>
          {validation.valid ? (
            <p className="text-green-700 font-semibold">Validation passed</p>
          ) : (
            <ul className="text-red-700 list-disc pl-5">
              {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {validation.valid && (
            <button onClick={adoptProposal} className="mt-2 px-4 py-2 bg-orange-600 text-white rounded">
              Adopt (single-use)
            </button>
          )}
        </section>
      )}

      {adoptionResult && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">4. Adoption Result</h2>
          {adoptionResult.adopted ? (
            <p className="text-green-700 font-semibold">Adopted successfully</p>
          ) : (
            <ul className="text-red-700 list-disc pl-5">
              {adoptionResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
