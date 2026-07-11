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
