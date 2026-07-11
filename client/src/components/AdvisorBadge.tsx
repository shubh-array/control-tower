// client/src/components/AdvisorBadge.tsx
import type { AdvisorResult } from "../lib/api.js";

interface AdvisorBadgeProps {
  result: AdvisorResult | null;
}

const RELEVANCE_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#16a34a",
  unknown: "#6b7280",
};

const RISK_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#16a34a",
  unknown: "#6b7280",
};

export function AdvisorBadge({ result }: AdvisorBadgeProps) {
  if (!result) {
    return (
      <span
        style={{ color: "#6b7280", fontSize: "0.75rem" }}
        title="No current advisor result"
      >
        —
      </span>
    );
  }

  const stalePrefix = result.stale ? "⚠ Stale — " : "";

  return (
    <span
      style={{ display: "inline-flex", gap: "4px", fontSize: "0.75rem" }}
      title={`${stalePrefix}${result.explanation}`}
    >
      <span
        style={{
          padding: "1px 6px",
          borderRadius: "4px",
          backgroundColor: RELEVANCE_COLORS[result.relevance] ?? "#6b7280",
          color: "#fff",
          opacity: result.stale ? 0.6 : 1,
        }}
      >
        {result.relevance}
      </span>
      <span
        style={{
          padding: "1px 6px",
          borderRadius: "4px",
          backgroundColor: RISK_COLORS[result.risk] ?? "#6b7280",
          color: "#fff",
          opacity: result.stale ? 0.6 : 1,
        }}
      >
        {result.risk}
      </span>
      {result.stale && (
        <span style={{ color: "#ca8a04", fontStyle: "italic" }}>stale</span>
      )}
    </span>
  );
}
