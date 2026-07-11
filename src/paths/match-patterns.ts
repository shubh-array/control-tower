import { CanonicalPathMatcher } from "./matcher.js";
import type { PatternSource } from "./matcher.js";

export function pathMatchesAny(
  canonicalPath: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  const sources: PatternSource[] = patterns.map((pattern) => ({
    pattern,
    source: "policy" as const,
  }));
  try {
    const matcher = CanonicalPathMatcher.compile(sources);
    return matcher.matches(canonicalPath);
  } catch {
    return false;
  }
}
