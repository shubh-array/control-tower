import { CanonicalPathMatcher } from '../paths/matcher.js';
import type { DiffFilterOutcome } from '../context/coverage.js';

export type { DiffFilterOutcome };

export interface DiffFetchDeps {
  execGhText: (args: string[], opts: { host: string }) => Promise<string>;
  host: string;
  protectedPathPatterns: string[];
}

export interface DiffFetchResult {
  filtered: string;
  omittedPaths: string[];
  outcome: DiffFilterOutcome;
}

function filterUnifiedDiff(
  unifiedDiff: string,
  matcher: CanonicalPathMatcher,
): { filtered: string; omittedPaths: string[] } {
  const lines = unifiedDiff.split('\n');
  const outputLines: string[] = [];
  const omittedPaths: string[] = [];
  let omitting = false;

  for (const line of lines) {
    const diffMatch = /^diff --git a\/(.+) b\//.exec(line);
    if (diffMatch) {
      const currentPath = diffMatch[1]!;
      omitting = matcher.matches(currentPath);
      if (omitting) {
        omittedPaths.push(currentPath);
      }
    }

    if (!omitting) {
      outputLines.push(line);
    }
  }

  return {
    filtered: outputLines.join('\n'),
    omittedPaths: [...new Set(omittedPaths)],
  };
}

export async function fetchAndFilterPrDiff(
  deps: DiffFetchDeps,
  ownerRepo: string,
  prNumber: number,
): Promise<DiffFetchResult> {
  let rawDiff: string;
  try {
    rawDiff = await deps.execGhText(
      ['pr', 'diff', String(prNumber), '--repo', ownerRepo],
      { host: deps.host },
    );
  } catch {
    return { filtered: '', omittedPaths: [], outcome: 'failed' };
  }

  if (deps.protectedPathPatterns.length === 0) {
    return { filtered: rawDiff, omittedPaths: [], outcome: 'succeeded' };
  }

  const matcher = CanonicalPathMatcher.compile(
    deps.protectedPathPatterns.map((pattern) => ({
      pattern,
      source: 'organization.security.protectedPaths',
    })),
  );

  const { filtered, omittedPaths } = filterUnifiedDiff(rawDiff, matcher);
  return { filtered, omittedPaths, outcome: 'succeeded' };
}
