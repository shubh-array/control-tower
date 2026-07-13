import type { AdvisorResult } from "../lib/api.js";
import { SafeText } from "./SafeText.js";

interface AdvisorNoteProps {
  result: AdvisorResult | null;
}

function formatAdvice(result: AdvisorResult): string {
  const explanation = result.explanation.trim();
  if (explanation.length > 0) {
    return explanation;
  }
  return result.recommendedAction.replaceAll("_", " ");
}

export function AdvisorNote({ result }: AdvisorNoteProps) {
  if (!result) {
    return (
      <p className="advisor-note advisor-note--empty">
        Advisor: Not available
      </p>
    );
  }

  const prefix = result.stale ? "Stale advice — " : "";
  const text = `${prefix}${formatAdvice(result)}`;

  return (
    <p className="advisor-note">
      Advisor: <SafeText text={text} />
    </p>
  );
}
