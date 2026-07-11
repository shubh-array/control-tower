export { CanonicalPathMatcher } from "./matcher.js";
export type { PatternSource, MatcherArtifact } from "./matcher.js";

import { CanonicalPathMatcher } from "./matcher.js";

export function compileGlobs(globs: readonly string[]): CanonicalPathMatcher {
  return CanonicalPathMatcher.compile(
    globs.map((pattern) => ({ pattern, source: "doctor" })),
  );
}
