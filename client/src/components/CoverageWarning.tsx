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
    <div role="alert" className="coverage-warning">
      <strong className="coverage-warning__title">Coverage notice</strong>
      <ul className="coverage-warning__list">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      <p className="coverage-warning__footnote">
        CI results observed. Local checks were not run.
      </p>
    </div>
  );
}
