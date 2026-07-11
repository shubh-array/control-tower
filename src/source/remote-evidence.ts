export interface ProtectedOmission {
  path: string;
  reason: string;
}

export interface RemoteEvidenceResult {
  sourceTreeInspected: false;
  missingCoverage: string[];
  omittedProtectedPaths: ProtectedOmission[];
  omittedSourceEntries: string[];
}

export function buildRemoteEvidenceCoverage(
  protectedOmissions: ProtectedOmission[],
): RemoteEvidenceResult {
  return {
    sourceTreeInspected: false,
    missingCoverage: ['source_tree'],
    omittedProtectedPaths: protectedOmissions,
    omittedSourceEntries: [],
  };
}

export function isRemoteEvidenceOnly(repo: {
  registered: boolean;
  active: boolean;
  doctorPassed: boolean;
}): boolean {
  return !(repo.registered && repo.active && repo.doctorPassed);
}
