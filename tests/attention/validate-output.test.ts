import { describe, it, expect } from 'vitest';
import {
  validateAttentionOutput,
  type AttentionOutputItem,
  type AttentionValidationInput,
} from '../../src/attention/validate-output.js';

function makeInput(candidates: Array<{ repositoryKey: string; prNumber: number; headSha: string }>): AttentionValidationInput {
  return { candidates };
}

function makeValidItem(repo: string, pr: number, head: string): AttentionOutputItem {
  return {
    repositoryKey: repo,
    prNumber: pr,
    headSha: head,
    relevance: 'medium',
    risk: 'low',
    explanation: 'Standard changes.',
    recommendedAction: 'analyze_on_demand',
    confidence: 'high',
    unknowns: [],
  };
}

describe('validateAttentionOutput', () => {
  it('accepts valid output matching all candidates', () => {
    const input = makeInput([
      { repositoryKey: 'pba-webapp', prNumber: 1, headSha: 'a'.repeat(40) },
    ]);
    const output = {
      schemaVersion: 1,
      items: [makeValidItem('pba-webapp', 1, 'a'.repeat(40))],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(true);
  });

  it('rejects when candidate is missing from output', () => {
    const input = makeInput([
      { repositoryKey: 'pba-webapp', prNumber: 1, headSha: 'a'.repeat(40) },
      { repositoryKey: 'pba-webapp', prNumber: 2, headSha: 'b'.repeat(40) },
    ]);
    const output = {
      schemaVersion: 1,
      items: [makeValidItem('pba-webapp', 1, 'a'.repeat(40))],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('missing output for candidate pba-webapp#2');
  });

  it('rejects extra items not in input candidates', () => {
    const input = makeInput([
      { repositoryKey: 'pba-webapp', prNumber: 1, headSha: 'a'.repeat(40) },
    ]);
    const output = {
      schemaVersion: 1,
      items: [
        makeValidItem('pba-webapp', 1, 'a'.repeat(40)),
        makeValidItem('pba-webapp', 99, 'c'.repeat(40)),
      ],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('extra'))).toBe(true);
  });

  it('rejects explanation over 1000 characters', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = makeValidItem('r', 1, 'a'.repeat(40));
    item.explanation = 'x'.repeat(1001);
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });

  it('rejects more than 10 unknowns', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = makeValidItem('r', 1, 'a'.repeat(40));
    item.unknowns = Array.from({ length: 11 }, (_, i) => `unknown-${i}`);
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });

  it('rejects mismatched headSha', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const output = {
      schemaVersion: 1,
      items: [makeValidItem('r', 1, 'b'.repeat(40))],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid relevance enum', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = makeValidItem('r', 1, 'a'.repeat(40));
    (item as { relevance: string }).relevance = 'super_critical';
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });

  it('rejects any numeric or batch-relative rank field', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = { ...makeValidItem('r', 1, 'a'.repeat(40)), rank: 1 };
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rank'))).toBe(true);
  });

  it('CRITICAL: advice output contains no analysis-enqueue field', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = { ...makeValidItem('r', 1, 'a'.repeat(40)), enqueueAnalysis: true };
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });
});
