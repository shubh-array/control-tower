const SEVERITY_TONES = new Set(["blocking", "high", "medium", "low"]);
const CONFIDENCE_TONES = new Set(["high", "medium", "low"]);

/** Maps an arbitrary agent-reported severity string to a known chip tone, defaulting safely. */
export function severityTone(severity: string): string {
  const normalized = severity.toLowerCase();
  return SEVERITY_TONES.has(normalized) ? normalized : "other";
}

/** Maps an arbitrary agent-reported confidence string to a known chip tone, defaulting safely. */
export function confidenceTone(confidence: string): string {
  const normalized = confidence.toLowerCase();
  return CONFIDENCE_TONES.has(normalized) ? normalized : "other";
}
