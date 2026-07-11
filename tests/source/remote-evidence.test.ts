import { describe, it, expect } from 'vitest';
import {
  buildRemoteEvidenceCoverage,
  isRemoteEvidenceOnly,
} from '../../src/source/remote-evidence.js';

describe('buildRemoteEvidenceCoverage', () => {
  it('sets sourceTreeInspected to false', () => {
    const coverage = buildRemoteEvidenceCoverage([]);
    expect(coverage.sourceTreeInspected).toBe(false);
  });

  it('includes source_tree in missingCoverage', () => {
    const coverage = buildRemoteEvidenceCoverage([]);
    expect(coverage.missingCoverage).toContain('source_tree');
  });

  it('CRITICAL: produces no source manifest', () => {
    const coverage = buildRemoteEvidenceCoverage([]);
    expect(coverage).not.toHaveProperty('sourceManifest');
  });

  it('records protected path omissions by name only', () => {
    const coverage = buildRemoteEvidenceCoverage([
      { path: '.env', reason: 'protected_path_content' },
    ]);
    expect(coverage.omittedProtectedPaths).toEqual([
      { path: '.env', reason: 'protected_path_content' },
    ]);
  });
});

describe('isRemoteEvidenceOnly', () => {
  it('returns true for unregistered repositories', () => {
    expect(isRemoteEvidenceOnly({ registered: false, active: false, doctorPassed: false })).toBe(true);
  });

  it('returns true for inactive repositories', () => {
    expect(isRemoteEvidenceOnly({ registered: true, active: false, doctorPassed: true })).toBe(true);
  });

  it('returns false for registered, active, doctor-passed repositories', () => {
    expect(isRemoteEvidenceOnly({ registered: true, active: true, doctorPassed: true })).toBe(false);
  });
});
