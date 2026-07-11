// client/src/routes/AllTracked.tsx
import { useEffect, useState } from "react";
import { api, type TrackedQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { AdvisorBadge } from "../components/AdvisorBadge.js";

export function AllTracked() {
  const [items, setItems] = useState<TrackedQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzingPr, setAnalyzingPr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getQueue()
      .then((data) => {
        setItems(data.allTracked);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleAnalyze = async (item: TrackedQueueRow) => {
    const key = `${item.repository}-${item.prNumber}`;
    setAnalyzingPr(key);
    try {
      await api.requestAnalyze({
        repositoryKey: item.repository,
        prNumber: item.prNumber,
      });
    } finally {
      setAnalyzingPr(null);
    }
  };

  if (loading) return <p>Loading tracked PRs…</p>;
  if (error) return <p style={{ color: "#dc2626" }}>Error: {error}</p>;

  return (
    <div>
      <h2>All Tracked ({items.length})</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ padding: "8px" }}>PR</th>
            <th style={{ padding: "8px" }}>Title</th>
            <th style={{ padding: "8px" }}>Author</th>
            <th style={{ padding: "8px" }}>Priority</th>
            <th style={{ padding: "8px" }}>Eligibility</th>
            <th style={{ padding: "8px" }}>Status</th>
            <th style={{ padding: "8px" }}>Advisor</th>
            <th style={{ padding: "8px" }}>Updated</th>
            <th style={{ padding: "8px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={`${item.repository}-${item.prNumber}`}
              style={{ borderBottom: "1px solid #f3f4f6" }}
            >
              <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "0.875rem" }}>
                <SafeText text={`${item.repository.split("/")[1]}#${item.prNumber}`} />
              </td>
              <td style={{ padding: "8px" }}>
                <SafeText text={item.title} />
              </td>
              <td style={{ padding: "8px", fontSize: "0.875rem" }}>
                <SafeText text={item.author} />
              </td>
              <td style={{ padding: "8px" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    backgroundColor:
                      item.priority === "unranked" ? "#f3f4f6" : "#dbeafe",
                    color:
                      item.priority === "unranked" ? "#6b7280" : "#1d4ed8",
                  }}
                >
                  {item.priority === "unranked"
                    ? "Unranked — ineligible"
                    : item.priority.toUpperCase()}
                </span>
              </td>
              <td style={{ padding: "8px", fontSize: "0.75rem" }}>
                {item.eligibilityReasons.map((r, i) => (
                  <div key={i} style={{ color: "#16a34a" }}>
                    <SafeText text={r.code.replace(/_/g, " ")} />
                  </div>
                ))}
                {item.exclusionReasons.map((r, i) => (
                  <div key={`ex-${i}`} style={{ color: "#dc2626" }}>
                    <SafeText text={`✗ ${r.code.replace(/_/g, " ")}${r.detail ? `: ${r.detail}` : ""}`} />
                  </div>
                ))}
              </td>
              <td style={{ padding: "8px", fontSize: "0.875rem" }}>
                <SafeText text={item.attentionState.replace(/_/g, " ")} />
              </td>
              <td style={{ padding: "8px" }}>
                <AdvisorBadge result={item.advisorResult} />
              </td>
              <td
                style={{ padding: "8px", fontSize: "0.75rem", color: "#6b7280" }}
              >
                {new Date(item.updatedAt).toLocaleDateString()}
              </td>
              <td style={{ padding: "8px" }}>
                <button
                  disabled={analyzingPr === `${item.repository}-${item.prNumber}`}
                  onClick={() => handleAnalyze(item)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "0.75rem",
                    border: "1px solid #2563eb",
                    borderRadius: "4px",
                    backgroundColor: "#eff6ff",
                    color: "#2563eb",
                    cursor: analyzingPr === `${item.repository}-${item.prNumber}` ? "wait" : "pointer",
                  }}
                >
                  Analyze
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
