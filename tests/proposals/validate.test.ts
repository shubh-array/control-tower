import { describe, it, expect } from 'vitest';
import {
  PROPOSAL_TARGET_ALLOWLIST,
  MAX_PROPOSAL_TARGETS,
  MAX_PROPOSAL_SIZE_BYTES,
  MAX_PER_FILE_SIZE_BYTES,
  type ProfileChangeProposal,
  type ProposalTarget,
  isAllowedTarget,
} from '../../src/proposals/types';

describe('Proposal Types', () => {
  it('allowlist contains exactly the permitted targets', () => {
    expect(PROPOSAL_TARGET_ALLOWLIST).toEqual([
      'policy.json',
      'persona.md',
      'harnesses/<feature>/prompt.md',
      'harnesses/<feature>/skills/<skill>/SKILL.md',
    ]);
  });

  it('max targets is 4', () => {
    expect(MAX_PROPOSAL_TARGETS).toBe(4);
  });

  it('max total proposal size is 1 MiB', () => {
    expect(MAX_PROPOSAL_SIZE_BYTES).toBe(1024 * 1024);
  });

  it('max per-file replacement size is 256 KiB', () => {
    expect(MAX_PER_FILE_SIZE_BYTES).toBe(256 * 1024);
  });

  it('accepts valid policy.json target', () => {
    expect(isAllowedTarget('policy.json')).toBe(true);
  });

  it('accepts valid persona.md target', () => {
    expect(isAllowedTarget('persona.md')).toBe(true);
  });

  it('accepts valid feature prompt target', () => {
    expect(isAllowedTarget('harnesses/pr-review/prompt.md')).toBe(true);
  });

  it('accepts valid feature skill target', () => {
    expect(isAllowedTarget('harnesses/pr-review/skills/code-quality/SKILL.md')).toBe(true);
  });

  it('rejects machine config target', () => {
    expect(isAllowedTarget('machine.local.json')).toBe(false);
  });

  it('rejects organization authority files', () => {
    expect(isAllowedTarget('organization/authority.json')).toBe(false);
  });

  it('rejects application safety files', () => {
    expect(isAllowedTarget('src/safety/permissions.ts')).toBe(false);
  });

  it('rejects credential files', () => {
    expect(isAllowedTarget('.env')).toBe(false);
  });

  it('rejects schema files', () => {
    expect(isAllowedTarget('schemas/signal.json')).toBe(false);
  });
});

import { validateProposal } from '../../src/proposals/validate';

describe('validateProposal', () => {
  const validProposal: ProfileChangeProposal = {
    id: 'prop_001',
    version: 1,
    createdAt: '2026-07-10T12:00:00Z',
    selectedSignalHash: 'signals_abc',
    targetBaseContentHashes: { 'policy.json': 'base_policy' },
    immutableProposalContractHash: 'contract1',
    personaHash: 'persona1',
    modelSpecHash: 'model_primary',
    targets: [{
      path: 'policy.json',
      baseContentHash: 'base_policy',
      proposedContent: '{"autoAnalyze":{"enabled":true}}',
      rationale: 'Enable auto-analysis based on signal trends',
      expectedEffect: 'PRs matching priority tiers auto-analyze',
      risks: ['May increase agent usage'],
      replayCases: ['case_attention_01'],
    }],
    status: 'pending_validation',
  };

  it('accepts a valid proposal with allowed target and matching base hash', () => {
    const currentFiles = { 'policy.json': { content: '{}', hash: 'base_policy' } };
    const result = validateProposal(validProposal, currentFiles);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects proposal with disallowed target path', () => {
    const badProposal = {
      ...validProposal,
      targets: [{ ...validProposal.targets[0], path: 'src/safety/guards.ts' }],
      targetBaseContentHashes: { 'src/safety/guards.ts': 'x' },
    };
    const currentFiles = { 'src/safety/guards.ts': { content: '', hash: 'x' } };
    const result = validateProposal(badProposal, currentFiles);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Target "src/safety/guards.ts" is not in the allowlist');
  });

  it('rejects proposal with base hash mismatch', () => {
    const currentFiles = { 'policy.json': { content: '{}', hash: 'different_hash' } };
    const result = validateProposal(validProposal, currentFiles);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Base hash mismatch');
  });

  it('rejects proposal exceeding max targets', () => {
    const tooMany = {
      ...validProposal,
      targets: Array.from({ length: 5 }, (_, i) => ({
        ...validProposal.targets[0],
        path: `policy.json`,
        baseContentHash: `h${i}`,
      })),
    };
    const currentFiles = { 'policy.json': { content: '', hash: 'h0' } };
    const result = validateProposal(tooMany, currentFiles);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('exceeds maximum');
  });

  it('rejects proposal with per-file content exceeding 256 KiB', () => {
    const bigContent = 'x'.repeat(256 * 1024 + 1);
    const bigProposal = {
      ...validProposal,
      targets: [{ ...validProposal.targets[0], proposedContent: bigContent }],
    };
    const currentFiles = { 'policy.json': { content: '', hash: 'base_policy' } };
    const result = validateProposal(bigProposal, currentFiles);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('exceeds 256 KiB');
  });
});
