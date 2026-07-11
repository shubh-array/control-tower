import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { adoptProposal, resetAdoptionState } from '../../src/proposals/adopt.js';
import { sha256Hex } from '../../src/util/hash.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('adoptProposal', () => {
  let profileDir: string;

  beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'ct-adopt-'));
    writeFileSync(join(profileDir, 'policy.json'), '{"version":1}');
    writeFileSync(join(profileDir, 'persona.md'), '# Persona\nDefault');
  });

  afterEach(() => {
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('atomically writes only the previewed files when hashes match', () => {
    const currentContent = '{"version":1}';
    const proposedContent = '{"version":2,"autoAnalyze":true}';
    const result = adoptProposal({
      profileDir,
      proposalId: 'prop_001',
      proposalVersion: 1,
      targets: [{
        path: 'policy.json',
        baseContentHash: sha256Hex(currentContent),
        proposedContent,
        contentHash: sha256Hex(proposedContent),
      }],
    });
    expect(result.adopted).toBe(true);
    expect(result.errors).toHaveLength(0);
    const written = readFileSync(join(profileDir, 'policy.json'), 'utf-8');
    expect(written).toBe(proposedContent);
  });

  it('rejects adoption when base hash is stale', () => {
    const proposedContent = '{"version":2}';
    const result = adoptProposal({
      profileDir,
      proposalId: 'prop_002',
      proposalVersion: 1,
      targets: [{
        path: 'policy.json',
        baseContentHash: 'wrong_hash',
        proposedContent,
        contentHash: sha256Hex(proposedContent),
      }],
    });
    expect(result.adopted).toBe(false);
    expect(result.errors[0]).toContain('stale');
    const unchanged = readFileSync(join(profileDir, 'policy.json'), 'utf-8');
    expect(unchanged).toBe('{"version":1}');
  });

  it('writes nothing if any target hash is stale (atomic)', () => {
    const policyContent = '{"version":1}';
    const personaContent = '# Persona\nDefault';
    const result = adoptProposal({
      profileDir,
      proposalId: 'prop_003',
      proposalVersion: 1,
      targets: [
        {
          path: 'policy.json',
          baseContentHash: sha256Hex(policyContent),
          proposedContent: '{"version":2}',
          contentHash: sha256Hex('{"version":2}'),
        },
        {
          path: 'persona.md',
          baseContentHash: 'wrong_persona_hash',
          proposedContent: '# Persona\nUpdated',
          contentHash: sha256Hex('# Persona\nUpdated'),
        },
      ],
    });
    expect(result.adopted).toBe(false);
    expect(readFileSync(join(profileDir, 'policy.json'), 'utf-8')).toBe(policyContent);
    expect(readFileSync(join(profileDir, 'persona.md'), 'utf-8')).toBe(personaContent);
  });

  it('is single-use: same proposal cannot be adopted twice', () => {
    const currentContent = '{"version":1}';
    const proposedContent = '{"version":2}';
    const opts = {
      profileDir,
      proposalId: 'prop_004',
      proposalVersion: 1,
      targets: [{
        path: 'policy.json',
        baseContentHash: sha256Hex(currentContent),
        proposedContent,
        contentHash: sha256Hex(proposedContent),
      }],
    };
    const first = adoptProposal(opts);
    expect(first.adopted).toBe(true);
    const second = adoptProposal(opts);
    expect(second.adopted).toBe(false);
    expect(second.errors[0]).toContain('already adopted');
  });

  it('persists single-use adoption across process-local reset', () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'ct-adopt-persist-'));
    const currentContent = '{"version":1}';
    const proposedContent = '{"version":2}';
    const opts = {
      profileDir,
      dataDirectory,
      proposalId: 'prop_005',
      proposalVersion: 1,
      targets: [{
        path: 'policy.json',
        baseContentHash: sha256Hex(currentContent),
        proposedContent,
        contentHash: sha256Hex(proposedContent),
      }],
    };
    expect(adoptProposal(opts).adopted).toBe(true);
    resetAdoptionState();
    const second = adoptProposal(opts);
    expect(second.adopted).toBe(false);
    expect(second.errors[0]).toContain('already adopted');
    rmSync(dataDirectory, { recursive: true, force: true });
  });
});
