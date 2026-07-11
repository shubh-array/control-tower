import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sha256Hex } from '../../src/util/hash.js';
import { adoptProposal } from '../../src/proposals/adopt.js';
import { generatePreview, type PreviewLine } from '../../src/proposals/preview.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface AuditRecord {
  proposalId: string;
  proposalVersion: number;
  targetPath: string;
  baseContent: string;
  baseContentHash: string;
  proposedContent: string;
  proposedContentHash: string;
  adoptedAt: string;
  adoptedBy: string;
}

describe('Audit Replay Reproducibility', () => {
  let profileDir: string;

  beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'ct-audit-replay-'));
  });

  afterEach(() => {
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('replaying an audit record reproduces proposal version and content hashes', () => {
    const baseContent = '{"version":1,"rules":[]}';
    const proposedContent = '{"version":2,"rules":["no-unused-vars"]}';

    const audit: AuditRecord = {
      proposalId: 'prop_replay_001',
      proposalVersion: 1,
      targetPath: 'policy.json',
      baseContent,
      baseContentHash: sha256Hex(baseContent),
      proposedContent,
      proposedContentHash: sha256Hex(proposedContent),
      adoptedAt: '2026-07-10T14:00:00Z',
      adoptedBy: 'engineer@example.com',
    };

    expect(sha256Hex(audit.baseContent)).toBe(audit.baseContentHash);
    expect(sha256Hex(audit.proposedContent)).toBe(audit.proposedContentHash);

    const preview = generatePreview(
      audit.proposalId,
      audit.targetPath,
      audit.baseContent,
      audit.proposedContent,
    );
    expect(preview.baseHash).toBe(audit.baseContentHash);
    expect(preview.proposedHash).toBe(audit.proposedContentHash);
    expect(preview.proposalId).toBe(audit.proposalId);
    expect(preview.lines.some((l: PreviewLine) => l.type === 'added')).toBe(true);
    expect(preview.lines.some((l: PreviewLine) => l.type === 'removed')).toBe(true);
  });

  it('replaying adoption from audit record produces identical file content', () => {
    const baseContent = '# Persona\nDefault reviewer';
    const proposedContent = '# Persona\nSecurity-focused reviewer';

    writeFileSync(join(profileDir, 'persona.md'), baseContent);

    const audit: AuditRecord = {
      proposalId: 'prop_replay_002',
      proposalVersion: 1,
      targetPath: 'persona.md',
      baseContent,
      baseContentHash: sha256Hex(baseContent),
      proposedContent,
      proposedContentHash: sha256Hex(proposedContent),
      adoptedAt: '2026-07-10T14:05:00Z',
      adoptedBy: 'engineer@example.com',
    };

    const result = adoptProposal({
      profileDir,
      proposalId: audit.proposalId,
      proposalVersion: audit.proposalVersion,
      targets: [{
        path: audit.targetPath,
        baseContentHash: audit.baseContentHash,
        proposedContent: audit.proposedContent,
        contentHash: audit.proposedContentHash,
      }],
    });

    expect(result.adopted).toBe(true);
    const written = readFileSync(join(profileDir, 'persona.md'), 'utf-8');
    expect(written).toBe(audit.proposedContent);
    expect(sha256Hex(written)).toBe(audit.proposedContentHash);
  });

  it('adoption identity is tied to proposalId + version (single-use)', () => {
    const base = '{"v":1}';
    const proposed = '{"v":2}';
    writeFileSync(join(profileDir, 'config.json'), base);

    const opts = {
      profileDir,
      proposalId: 'prop_replay_003',
      proposalVersion: 1,
      targets: [{
        path: 'config.json',
        baseContentHash: sha256Hex(base),
        proposedContent: proposed,
        contentHash: sha256Hex(proposed),
      }],
    };

    const first = adoptProposal(opts);
    expect(first.adopted).toBe(true);

    writeFileSync(join(profileDir, 'config.json'), proposed);
    const second = adoptProposal({
      ...opts,
      targets: [{
        path: 'config.json',
        baseContentHash: sha256Hex(proposed),
        proposedContent: '{"v":3}',
        contentHash: sha256Hex('{"v":3}'),
      }],
    });
    expect(second.adopted).toBe(false);
    expect(second.errors[0]).toContain('already adopted');
  });

  it('preview from audit record is stable across re-generation', () => {
    const base = 'line1\nline2\nline3';
    const proposed = 'line1\nmodified\nline3\nline4';

    const preview1 = generatePreview('prop_stable', 'file.txt', base, proposed);
    const preview2 = generatePreview('prop_stable', 'file.txt', base, proposed);

    expect(preview1.baseHash).toBe(preview2.baseHash);
    expect(preview1.proposedHash).toBe(preview2.proposedHash);
    expect(preview1.lines).toEqual(preview2.lines);
  });
});
