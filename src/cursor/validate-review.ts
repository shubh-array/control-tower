import type { CoverageObject } from '../context/coverage.js';
import { validateProvenanceRef, type ProvenanceRecord } from '../context/provenance.js';

const VALID_SEVERITY = new Set(['blocking', 'high', 'medium', 'low']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_DISPOSITION = new Set(['approve', 'comment', 'request_changes', 'needs_human']);
const VALID_OBS_TYPE = new Set(['observation', 'inference']);
const VALID_SIDE = new Set(['LEFT', 'RIGHT']);

export interface FileReference {
  repositoryId: string;
  blobSha: string;
  path: string;
  startLine: number;
  endLine: number;
}

export interface Observation {
  type: string;
  statement: string;
  provenanceRefs: string[];
  fileReferences: FileReference[];
}

export interface Finding {
  severity: string;
  confidence: string;
  title: string;
  rationale: string;
  file: string;
  location: { side: string; line: number; startSide: string | null; startLine: number | null } | null;
  observationIndexes: number[];
  draftComment: string;
}

export interface ReviewOutput {
  schemaVersion: number;
  coverage: CoverageObject;
  summary: { intent: string; implementation: string };
  observations: Observation[];
  checks: Array<{ provenanceRef: string; name: string; status: string; source: string }>;
  findings: Finding[];
  unknowns: string[];
  recommendedDisposition: string;
  draftSummary: {
    body: string;
    observationIndexes: number[];
    provenanceRefs: string[];
  };
}

export interface ReviewValidationInput {
  coverage: CoverageObject;
  catalog: Map<string, ProvenanceRecord>;
  sourceManifest: Map<string, { blobSha: string; lineCount: number }>;
  sourceMode: 'registered-source' | 'remote-evidence-only';
}

export interface ReviewValidationResult {
  valid: boolean;
  errors: string[];
  validatedProvenance: ProvenanceRecord[];
}

export function validateReviewOutput(
  output: ReviewOutput,
  input: ReviewValidationInput,
): ReviewValidationResult {
  const errors: string[] = [];
  const citedProvenance = new Set<string>();

  if (output.schemaVersion !== 1) {
    errors.push(`invalid schemaVersion: ${output.schemaVersion}`);
  }

  if (JSON.stringify(output.coverage) !== JSON.stringify(input.coverage)) {
    errors.push('coverage declaration does not match application-provided coverage');
  }

  if (!VALID_DISPOSITION.has(output.recommendedDisposition)) {
    errors.push(`invalid recommendedDisposition: ${output.recommendedDisposition}`);
  }

  for (let i = 0; i < output.observations.length; i++) {
    const obs = output.observations[i];
    if (!obs) continue;
    if (!VALID_OBS_TYPE.has(obs.type)) {
      errors.push(`observation[${i}]: invalid type '${obs.type}'`);
    }
    if (obs.provenanceRefs.length === 0 && obs.fileReferences.length === 0) {
      errors.push(`observation[${i}]: must have at least one provenance ref or file reference`);
    }
    for (const ref of obs.provenanceRefs) {
      if (!validateProvenanceRef(ref, input.catalog)) {
        errors.push(`observation[${i}]: unknown provenance ref '${ref}'`);
      } else {
        citedProvenance.add(ref);
      }
    }
    for (const fileRef of obs.fileReferences) {
      if (input.sourceMode === 'remote-evidence-only') {
        errors.push(`observation[${i}]: file reference not allowed in remote-evidence-only`);
      } else {
        const entry = input.sourceManifest.get(fileRef.path);
        if (entry && entry.blobSha !== fileRef.blobSha) {
          errors.push(`observation[${i}]: blob SHA mismatch for ${fileRef.path}`);
        }
        if (fileRef.startLine < 1 || fileRef.endLine < fileRef.startLine) {
          errors.push(`observation[${i}]: invalid line range ${fileRef.startLine}-${fileRef.endLine}`);
        }
        if (entry && fileRef.endLine > entry.lineCount) {
          errors.push(`observation[${i}]: line ${fileRef.endLine} exceeds file length ${entry.lineCount} for ${fileRef.path}`);
        }
      }
    }
  }

  for (let i = 0; i < output.findings.length; i++) {
    const finding = output.findings[i];
    if (!finding) continue;
    if (!VALID_SEVERITY.has(finding.severity)) {
      errors.push(`finding[${i}]: invalid severity '${finding.severity}'`);
    }
    if (!VALID_CONFIDENCE.has(finding.confidence)) {
      errors.push(`finding[${i}]: invalid confidence '${finding.confidence}'`);
    }
    for (const idx of finding.observationIndexes) {
      if (idx < 0 || idx >= output.observations.length) {
        errors.push(`finding[${i}]: observationIndexes[${idx}] out of range`);
      }
    }
    if (finding.observationIndexes.length === 0) {
      errors.push(`finding[${i}]: must reference at least one observation`);
    }
    if (finding.location) {
      if (!VALID_SIDE.has(finding.location.side)) {
        errors.push(`finding[${i}]: invalid location side '${finding.location.side}'`);
      }
    }
  }

  for (const check of output.checks) {
    if (!validateProvenanceRef(check.provenanceRef, input.catalog)) {
      errors.push(`check '${check.name}': unknown provenanceRef '${check.provenanceRef}'`);
    } else {
      citedProvenance.add(check.provenanceRef);
    }
  }

  if (!output.draftSummary.body || output.draftSummary.body.trim().length === 0) {
    errors.push('draftSummary.body must be non-empty');
  }
  if (output.draftSummary.observationIndexes.length === 0 && output.draftSummary.provenanceRefs.length === 0) {
    errors.push('draftSummary must have non-empty observation indexes or provenance refs');
  }
  for (const ref of output.draftSummary.provenanceRefs) {
    if (!validateProvenanceRef(ref, input.catalog)) {
      errors.push(`draftSummary: unknown provenanceRef '${ref}'`);
    } else {
      citedProvenance.add(ref);
    }
  }
  for (const idx of output.draftSummary.observationIndexes) {
    if (idx < 0 || idx >= output.observations.length) {
      errors.push(`draftSummary: observationIndexes[${idx}] out of range`);
    }
  }

  const dups = output.draftSummary.provenanceRefs.filter(
    (v, i, a) => a.indexOf(v) !== i,
  );
  if (dups.length > 0) {
    errors.push(`draftSummary: duplicate provenanceRefs: ${dups.join(', ')}`);
  }

  const validatedProvenance: ProvenanceRecord[] = [];
  for (const id of citedProvenance) {
    const record = input.catalog.get(id);
    if (record) validatedProvenance.push(record);
  }

  return { valid: errors.length === 0, errors, validatedProvenance };
}
