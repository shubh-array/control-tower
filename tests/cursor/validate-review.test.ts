import { describe, it, expect } from 'vitest';
import {
  validateReviewOutput,
  type ReviewOutput,
  type ReviewValidationInput,
} from '../../src/cursor/validate-review.js';
import { createDiffHunkRecord, type ProvenanceRecord } from '../../src/context/provenance.js';

function makeCatalog(): Map<string, ProvenanceRecord> {
  const rec = createDiffHunkRecord({
    repositoryId: 'pba-webapp',
    baseSha: 'base',
    headSha: 'head',
    canonicalPath: 'src/index.ts',
    hunkHash: 'hh',
    leftRange: { start: 1, end: 5 },
    rightRange: { start: 1, end: 7 },
  });
  return new Map([[rec.id, rec]]);
}

function makeValidOutput(catalog: Map<string, ProvenanceRecord>): ReviewOutput {
  const provId = [...catalog.keys()][0];
  return {
    schemaVersion: 1,
    coverage: {
      mode: 'registered-source',
      sourceTreeInspected: true,
      diffFiltered: true,
      omittedProtectedPaths: [],
      omittedSourceEntries: [],
      missingCoverage: [],
    },
    summary: { intent: 'Add button', implementation: 'Added React component' },
    observations: [{
      type: 'observation',
      statement: 'The button component is created',
      provenanceRefs: [provId],
      fileReferences: [{
        repositoryId: 'pba-webapp',
        blobSha: 'blob-sha-1',
        path: 'src/components/Button.tsx',
        startLine: 1,
        endLine: 10,
      }],
    }],
    checks: [],
    findings: [{
      severity: 'medium',
      confidence: 'high',
      title: 'Missing test',
      rationale: 'No test for Button',
      file: 'src/components/Button.tsx',
      location: { side: 'RIGHT', line: 5, startSide: null, startLine: null },
      observationIndexes: [0],
      draftComment: 'Consider adding tests',
    }],
    unknowns: [],
    recommendedDisposition: 'comment',
    draftSummary: {
      body: 'This PR adds a Button component.',
      observationIndexes: [0],
      provenanceRefs: [provId],
    },
  };
}

const REGISTERED_COVERAGE = {
  mode: 'registered-source' as const,
  sourceTreeInspected: true,
  diffFiltered: true,
  omittedProtectedPaths: [],
  omittedSourceEntries: [],
  missingCoverage: [],
};

describe('validateReviewOutput', () => {
  it('accepts valid output with matching coverage and provenance', () => {
    const catalog = makeCatalog();
    const sourceManifest = new Map([['src/components/Button.tsx', { blobSha: 'blob-sha-1', lineCount: 50 }]]);
    const result = validateReviewOutput(
      makeValidOutput(catalog),
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest, sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects coverage mismatch', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.coverage.sourceTreeInspected = false;
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('coverage'))).toBe(true);
  });

  it('rejects unknown provenance ref', () => {
    const output = makeValidOutput(makeCatalog());
    output.observations[0].provenanceRefs = ['pv_invented'];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog: new Map(), sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('provenance'))).toBe(true);
  });

  it('CRITICAL: rejects file references in remote-evidence-only', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.coverage = {
      mode: 'remote-evidence-only',
      sourceTreeInspected: false,
      diffFiltered: true,
      omittedProtectedPaths: [],
      omittedSourceEntries: [],
      missingCoverage: ['source_tree'],
    };
    const remoteInput: ReviewValidationInput = {
      coverage: output.coverage,
      catalog,
      sourceManifest: new Map(),
      sourceMode: 'remote-evidence-only',
    };
    const result = validateReviewOutput(output, remoteInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('file reference') || e.includes('remote-evidence'))).toBe(true);
  });

  it('rejects observation with no provenance or file reference', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.observations[0].provenanceRefs = [];
    output.observations[0].fileReferences = [];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects finding with no valid observation index', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.findings[0].observationIndexes = [99];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects empty draftSummary body', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.draftSummary.body = '';
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects empty draftSummary provenance', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.draftSummary.provenanceRefs = [];
    output.draftSummary.observationIndexes = [];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });
});
