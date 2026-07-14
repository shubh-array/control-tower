import { describe, it, expect } from 'vitest';
import { fetchAndFilterPrDiff, type DiffFetchDeps } from '../../src/github/fetch-pr-diff.js';
import {
  buildRegisteredSourceCoverage,
  buildRemoteOnlyCoverage,
} from '../../src/context/coverage.js';
import {
  buildFullProvenanceCatalog,
  type ContextBuildInput,
  type ProvenanceLoadDeps,
} from '../../src/orchestrator/context-build.js';
import {
  createCheckRecord,
  createCommentRecord,
  validateProvenanceRef,
} from '../../src/context/provenance.js';
import { createHash } from 'node:crypto';

describe('fetchAndFilterPrDiff', () => {
  it('returns filtered diff with protected paths removed', async () => {
    const rawDiff = [
      'diff --git a/src/api/foo.ts b/src/api/foo.ts',
      '--- a/src/api/foo.ts',
      '+++ b/src/api/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '+added',
      ' line3',
      'diff --git a/.env b/.env',
      '--- a/.env',
      '+++ b/.env',
      '@@ -1,1 +1,2 @@',
      ' SECRET=old',
      '+SECRET2=new',
    ].join('\n');

    const deps: DiffFetchDeps = {
      execGhText: async () => rawDiff,
      host: 'github.com',
      protectedPathPatterns: ['**/.env', '**/.env.*'],
    };

    const result = await fetchAndFilterPrDiff(deps, 'Powered-By-Array/pba-webapp', 42);

    expect(result.filtered).toContain('src/api/foo.ts');
    expect(result.filtered).not.toContain('.env');
    expect(result.omittedPaths).toContain('.env');
    expect(result.outcome).toBe('succeeded');
  });

  it('returns failed outcome when gh errors', async () => {
    const deps: DiffFetchDeps = {
      execGhText: async () => { throw new Error('rate limited'); },
      host: 'github.com',
      protectedPathPatterns: [],
    };

    const result = await fetchAndFilterPrDiff(deps, 'org/repo', 1);

    expect(result.outcome).toBe('failed');
    expect(result.filtered).toBe('');
  });
});

describe('materializeDiffArtifact', () => {
  it('writes pr-diff.patch after context prep with stubbed gh', async () => {
    const stubDiff = 'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n';
    const deps: DiffFetchDeps = {
      execGhText: async () => stubDiff,
      host: 'github.com',
      protectedPathPatterns: [],
    };

    const result = await fetchAndFilterPrDiff(deps, 'org/repo', 42);

    expect(result.outcome).toBe('succeeded');
    expect(result.filtered).toContain('src/foo.ts');
  });
});

describe('honest coverage builders', () => {
  it('registered-source: sourceTreeInspected false before source prep', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'not_run', false);
    expect(cov.sourceTreeInspected).toBe(false);
    expect(cov.missingCoverage).toContain('source_tree');
  });

  it('registered-source: diffFiltered false when diff not_run', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'not_run', false);
    expect(cov.diffFiltered).toBe(false);
    expect(cov.missingCoverage).not.toContain('diff_filter_failed');
  });

  it('registered-source: diffFiltered false with diff_filter_failed when failed', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'failed', false);
    expect(cov.diffFiltered).toBe(false);
    expect(cov.missingCoverage).toContain('diff_filter_failed');
  });

  it('registered-source: diffFiltered true when succeeded', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'succeeded', true);
    expect(cov.diffFiltered).toBe(true);
    expect(cov.sourceTreeInspected).toBe(true);
    expect(cov.missingCoverage).not.toContain('source_tree');
  });

  it('remote-only: sourceTreeInspected always false', () => {
    const cov = buildRemoteOnlyCoverage([], 'succeeded');
    expect(cov.sourceTreeInspected).toBe(false);
    expect(cov.missingCoverage).toContain('source_tree');
    expect(cov.diffFiltered).toBe(true);
  });

  it('remote-only: diff not_run means diffFiltered false', () => {
    const cov = buildRemoteOnlyCoverage([], 'not_run');
    expect(cov.diffFiltered).toBe(false);
    expect(cov.missingCoverage).not.toContain('diff_filter_failed');
  });
});

describe('provenance catalog from discovery data', () => {
  it('builds check records from pr_checks-shaped rows', () => {
    const record = createCheckRecord({
      checkRunId: 42,
      attempt: 1,
      name: 'unit-tests',
      status: 'completed',
      conclusion: 'failure',
      url: 'https://github.com/org/repo/actions/runs/123',
      observedAt: '2026-07-13T00:00:00Z',
    });

    expect(record.type).toBe('check');
    expect(record.id).toMatch(/^pv_/);
    expect(record.data.name).toBe('unit-tests');
    expect(record.data.conclusion).toBe('failure');
  });

  it('builds comment records from pr_comments-shaped rows', () => {
    const bodyHash = createHash('sha256').update('Fix this bug').digest('hex');
    const record = createCommentRecord({
      nodeId: 'comment:1',
      databaseId: 1,
      authorLogin: 'reviewer',
      bodyHash,
      commitAssociation: null,
      createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:00Z',
    });

    expect(record.type).toBe('comment');
    expect(record.id).toMatch(/^pv_/);
    expect(record.data.authorLogin).toBe('reviewer');
  });

  it('catalog IDs are accepted by validateProvenanceRef', () => {
    const record = createCheckRecord({
      checkRunId: 1,
      attempt: 1,
      name: 'lint',
      status: 'completed',
      conclusion: 'success',
      url: '',
      observedAt: '2026-07-13T00:00:00Z',
    });

    const catalog = new Map([[record.id, record]]);
    expect(validateProvenanceRef(record.id, catalog)).toBe(true);
  });
});

describe('buildFullProvenanceCatalog', () => {
  it('includes commit, check, and comment records', () => {
    const input = {
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'abc123',
    } as ContextBuildInput;

    const deps: ProvenanceLoadDeps = {
      queryPrChecks: () => [{
        id: 1, name: 'unit-tests', status: 'completed',
        conclusion: 'failure', details_url: 'https://example.com',
      }],
      queryPrComments: () => [{
        id: 10, author_login: 'reviewer', body: 'Fix this',
        created_at: '2026-07-13T00:00:00Z', url: 'https://example.com/comment/10',
      }],
      queryPrFetchedAt: () => '2026-07-13T00:00:00Z',
    };

    const catalog = buildFullProvenanceCatalog(input, deps);

    expect(catalog.length).toBe(3);
    expect(catalog.map((r) => r.type).sort()).toEqual(['check', 'comment', 'commit']);
    for (const record of catalog) {
      expect(record.id).toMatch(/^pv_/);
    }
  });
});
