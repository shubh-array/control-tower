import { createHash } from 'node:crypto';

export type DiffFilterOutcome = 'not_run' | 'failed' | 'succeeded';

export interface CoverageObject {
  mode: 'registered-source' | 'remote-evidence-only';
  sourceTreeInspected: boolean;
  diffFiltered: boolean;
  omittedProtectedPaths: Array<{ path: string; reason: string }>;
  omittedSourceEntries: Array<{ path: string; reason: string }>;
  missingCoverage: string[];
}

export function buildRegisteredSourceCoverage(
  omittedProtectedPaths: Array<{ path: string; reason: string }>,
  omittedSourceEntries: Array<{ path: string; reason: string }>,
  diffFilterOutcome: DiffFilterOutcome,
  sourceTreeInspected: boolean,
): CoverageObject {
  const missingCoverage: string[] = [];
  if (!sourceTreeInspected) missingCoverage.push('source_tree');
  if (diffFilterOutcome === 'failed') missingCoverage.push('diff_filter_failed');
  if (omittedProtectedPaths.length > 0) missingCoverage.push('protected_path_content');

  return {
    mode: 'registered-source',
    sourceTreeInspected,
    diffFiltered: diffFilterOutcome === 'succeeded',
    omittedProtectedPaths,
    omittedSourceEntries,
    missingCoverage,
  };
}

export function buildRemoteOnlyCoverage(
  omittedProtectedPaths: Array<{ path: string; reason: string }>,
  diffFilterOutcome: DiffFilterOutcome,
): CoverageObject {
  const missingCoverage: string[] = ['source_tree'];
  if (diffFilterOutcome === 'failed') missingCoverage.push('diff_filter_failed');
  if (omittedProtectedPaths.length > 0) missingCoverage.push('protected_path_content');

  return {
    mode: 'remote-evidence-only',
    sourceTreeInspected: false,
    diffFiltered: diffFilterOutcome === 'succeeded',
    omittedProtectedPaths,
    omittedSourceEntries: [],
    missingCoverage,
  };
}

export function hashCoverage(coverage: CoverageObject): string {
  const canonical = JSON.stringify({
    diffFiltered: coverage.diffFiltered,
    missingCoverage: [...coverage.missingCoverage].sort(),
    mode: coverage.mode,
    omittedProtectedPaths: coverage.omittedProtectedPaths.map(p => `${p.path}:${p.reason}`).sort(),
    omittedSourceEntries: coverage.omittedSourceEntries.map(p => `${p.path}:${p.reason}`).sort(),
    sourceTreeInspected: coverage.sourceTreeInspected,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
