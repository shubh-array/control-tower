// tests/proposals/replay.test.ts
import { describe, it, expect } from 'vitest';
import { runHistoricalReplay, type ReplayConfig } from '../../src/proposals/replay';

describe('runHistoricalReplay', () => {
  it('replays corpus cases against proposed content and returns metrics', async () => {
    const config: ReplayConfig = {
      proposalId: 'prop_001',
      role: 'attention',
      proposedManifest: { harnessManifestHash: 'new_manifest' },
      corpusCases: [
        { caseId: 'attn_must_escalate_01', input: { candidates: [{ repo: 'webapp', pr: 10, headSha: 'aaa' }] }, expected: { mustEscalate: ['webapp#10'] } },
        { caseId: 'attn_low_risk_02', input: { candidates: [{ repo: 'docs', pr: 5, headSha: 'bbb' }] }, expected: { forbiddenEscalation: ['docs#5'] } },
      ],
      modelSpec: 'claude-sonnet-4-20250514',
      evaluator: (output, expected) => {
        return { passed: true, metricValues: { recall: 1.0, falseEscalation: 0.0 } };
      },
    };
    const result = await runHistoricalReplay(config);
    expect(result.proposalId).toBe('prop_001');
    expect(result.role).toBe('attention');
    expect(result.caseResults).toHaveLength(2);
    expect(result.caseResults.every(c => c.passed)).toBe(true);
  });

  it('records failures when evaluator returns passed=false', async () => {
    const config: ReplayConfig = {
      proposalId: 'prop_002',
      role: 'primaryReview',
      proposedManifest: { harnessManifestHash: 'new_manifest2' },
      corpusCases: [
        { caseId: 'review_provenance_01', input: { pr: { repo: 'webapp', number: 42 } }, expected: { provenanceValid: true } },
      ],
      modelSpec: 'claude-sonnet-4-20250514',
      evaluator: (_output, _expected) => {
        return { passed: false, metricValues: { provenanceValidity: 0.5 } };
      },
    };
    const result = await runHistoricalReplay(config);
    expect(result.caseResults[0].passed).toBe(false);
  });

  it('stores exact input hashes and manifest hashes', async () => {
    const config: ReplayConfig = {
      proposalId: 'prop_003',
      role: 'attention',
      proposedManifest: { harnessManifestHash: 'manifest_v3' },
      corpusCases: [
        { caseId: 'case_01', input: { candidates: [] }, expected: {} },
      ],
      modelSpec: 'claude-sonnet-4-20250514',
      evaluator: () => ({ passed: true, metricValues: {} }),
    };
    const result = await runHistoricalReplay(config);
    expect(result.corpusInputHash).toBeDefined();
    expect(result.afterManifestHash).toBe('manifest_v3');
  });
});
