import { describe, it, expect } from 'vitest';
import {
  createDiffHunkRecord,
  createCheckRecord,
  createCommentRecord,
  createCommitRecord,
  validateProvenanceRef,
  type ProvenanceRecord,
} from '../../src/context/provenance.js';

describe('provenance ID format', () => {
  it('generates pv_ prefixed IDs', () => {
    const record = createDiffHunkRecord({
      repositoryId: 'pba-webapp',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      canonicalPath: 'src/index.ts',
      hunkHash: 'hunk-hash-1',
      leftRange: { start: 1, end: 5 },
      rightRange: { start: 1, end: 7 },
    });
    expect(record.id).toMatch(/^pv_[a-z2-7]+$/);
  });

  it('is deterministic for same input', () => {
    const input = {
      repositoryId: 'pba-webapp',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      canonicalPath: 'src/index.ts',
      hunkHash: 'hunk-hash-1',
      leftRange: { start: 1, end: 5 },
      rightRange: { start: 1, end: 7 },
    };
    const r1 = createDiffHunkRecord(input);
    const r2 = createDiffHunkRecord(input);
    expect(r1.id).toBe(r2.id);
  });
});

describe('createCheckRecord', () => {
  it('binds check-run ID, name, status, conclusion', () => {
    const record = createCheckRecord({
      checkRunId: 12345,
      attempt: 1,
      name: 'CI / build',
      status: 'completed',
      conclusion: 'success',
      url: 'https://github.com/org/repo/actions/runs/1',
      observedAt: '2026-07-10T00:00:00Z',
    });
    expect(record.type).toBe('check');
    expect(record.id).toMatch(/^pv_/);
    expect(record.data.name).toBe('CI / build');
  });
});

describe('createCommentRecord', () => {
  it('binds GitHub node ID, author, body hash', () => {
    const record = createCommentRecord({
      nodeId: 'IC_kwDOA',
      databaseId: 1234,
      authorLogin: 'reviewer-1',
      bodyHash: 'body-hash-abc',
      commitAssociation: 'a'.repeat(40),
      createdAt: '2026-07-10T00:00:00Z',
      updatedAt: '2026-07-10T00:00:00Z',
    });
    expect(record.type).toBe('comment');
    expect(record.id).toMatch(/^pv_/);
  });
});

describe('createCommitRecord', () => {
  it('binds repository and commit SHA', () => {
    const record = createCommitRecord({
      repositoryId: 'pba-webapp',
      commitSha: 'c'.repeat(40),
    });
    expect(record.type).toBe('commit');
    expect(record.id).toMatch(/^pv_/);
  });
});

describe('validateProvenanceRef', () => {
  it('accepts a known catalog ID', () => {
    const catalog = new Map<string, ProvenanceRecord>();
    const record = createDiffHunkRecord({
      repositoryId: 'pba-webapp',
      baseSha: 'b',
      headSha: 'h',
      canonicalPath: 'f.ts',
      hunkHash: 'hh',
      leftRange: { start: 1, end: 1 },
      rightRange: { start: 1, end: 1 },
    });
    catalog.set(record.id, record);
    expect(validateProvenanceRef(record.id, catalog)).toBe(true);
  });

  it('rejects an unknown ID', () => {
    expect(validateProvenanceRef('pv_unknown', new Map())).toBe(false);
  });

  it('rejects an invented non-pv_ ID', () => {
    expect(validateProvenanceRef('invented-id', new Map())).toBe(false);
  });
});
