// client/src/components/CoverageWarning.tsx
import type { CoverageInfo } from "../lib/api.js";

interface CoverageWarningProps {
  coverage: CoverageInfo;
}

export function CoverageWarning({ coverage }: CoverageWarningProps) {
  const warnings: string[] = [];

  if (!coverage.sourceTreeInspected) {
    warnings.push(
      "Source tree not inspected — review based on remote evidence only",
    );
  }

  if (coverage.missingCoverage.length > 0) {
    warnings.push(`Missing coverage: ${coverage.missingCoverage.join(", ")}`);
  }

  if (coverage.omittedProtectedPaths.length > 0) {
    warnings.push(
      `Protected paths omitted: ${coverage.omittedProtectedPaths.join(", ")}`,
    );
  }

  if (!coverage.diffFiltered) {
    warnings.push("Diff was not filtered — coverage may be incomplete");
  }

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      style={{
        padding: "8px 12px",
        marginBottom: "12px",
        backgroundColor: "#fef3c7",
        border: "1px solid #f59e0b",
        borderRadius: "6px",
        fontSize: "0.875rem",
        color: "#92400e",
      }}
    >
      <strong>Coverage notice:</strong>
      <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      <p style={{ margin: "4px 0 0", fontSize: "0.75rem", fontStyle: "italic" }}>
        CI results observed. Local checks were not run.
      </p>
    </div>
  );
}
