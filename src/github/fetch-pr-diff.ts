import { CanonicalPathMatcher } from '../paths/matcher.js';
import type { DiffFilterOutcome } from '../context/coverage.js';
import { sha256Hex } from '../util/hash.js';

export type { DiffFilterOutcome };

export interface ParsedDiffHunk {
  canonicalPath: string;
  hunkHash: string;
  leftRange: { start: number; end: number };
  rightRange: { start: number; end: number };
}

const DIFF_GIT_RE = /^diff --git a\/(.+) b\//;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function rangeFromCount(start: number, count: number): { start: number; end: number } {
  if (count === 0) return { start, end: start };
  return { start, end: start + count - 1 };
}

export function parseDiffHunks(unifiedDiff: string): ParsedDiffHunk[] {
  if (!unifiedDiff) return [];

  const hunks: ParsedDiffHunk[] = [];
  const lines = unifiedDiff.split('\n');
  let currentPath: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const diffMatch = DIFF_GIT_RE.exec(line);
    if (diffMatch) {
      currentPath = diffMatch[1]!;
      continue;
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (!hunkMatch || !currentPath) continue;

    const leftStart = Number(hunkMatch[1]);
    const leftCount = hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1;
    const rightStart = Number(hunkMatch[3]);
    const rightCount = hunkMatch[4] !== undefined ? Number(hunkMatch[4]) : 1;

    const hunkLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.startsWith('diff --git ') || HUNK_HEADER_RE.test(next)) break;
      hunkLines.push(next);
      j++;
    }

    hunks.push({
      canonicalPath: currentPath,
      hunkHash: sha256Hex(hunkLines.join('\n')),
      leftRange: rangeFromCount(leftStart, leftCount),
      rightRange: rangeFromCount(rightStart, rightCount),
    });
    i = j - 1;
  }

  return hunks;
}

export interface DiffFetchDeps {
  execGhText: (args: string[], opts: { host: string }) => Promise<string>;
  host: string;
  protectedPathPatterns: string[];
}

export interface DiffFetchResult {
  filtered: string;
  omittedPaths: string[];
  outcome: DiffFilterOutcome;
  hunks: ParsedDiffHunk[];
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
    return { filtered: '', omittedPaths: [], outcome: 'failed', hunks: [] };
  }

  if (deps.protectedPathPatterns.length === 0) {
    return {
      filtered: rawDiff,
      omittedPaths: [],
      outcome: 'succeeded',
      hunks: parseDiffHunks(rawDiff),
    };
  }

  const matcher = CanonicalPathMatcher.compile(
    deps.protectedPathPatterns.map((pattern) => ({
      pattern,
      source: 'organization.security.protectedPaths',
    })),
  );

  const { filtered, omittedPaths } = filterUnifiedDiff(rawDiff, matcher);
  return {
    filtered,
    omittedPaths,
    outcome: 'succeeded',
    hunks: parseDiffHunks(filtered),
  };
}
