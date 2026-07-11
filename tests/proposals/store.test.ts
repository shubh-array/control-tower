import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemProposalStore } from '../../src/proposals/store.js';
import type { ProfileChangeProposal } from '../../src/proposals/types.js';

function stubProposal(id: string): ProfileChangeProposal {
  return {
    id,
    version: 1,
    createdAt: '2026-07-10T12:00:00.000Z',
    selectedSignalHash: 'sig_hash',
    targetBaseContentHashes: { 'persona.md': 'base_hash' },
    immutableProposalContractHash: 'contract_hash',
    personaHash: 'persona_hash',
    modelSpecHash: 'model_hash',
    targets: [{
      path: 'persona.md',
      baseContentHash: 'base_hash',
      proposedContent: '# Updated',
      rationale: 'test',
      expectedEffect: 'test',
      risks: [],
      replayCases: [],
    }],
    status: 'pending_validation',
  };
}

describe('FilesystemProposalStore', () => {
  let dataDir: string;
  let store: FilesystemProposalStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ct-proposal-store-'));
    store = new FilesystemProposalStore(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('persists proposals under data/proposals/', () => {
    const proposal = stubProposal('prop_fs_001');
    store.save(proposal);
    expect(existsSync(join(dataDir, 'proposals', 'prop_fs_001.json'))).toBe(true);
    expect(store.get('prop_fs_001')?.status).toBe('pending_validation');
  });

  it('survives store recreation (restart simulation)', () => {
    store.save(stubProposal('prop_fs_002'));
    const reloaded = new FilesystemProposalStore(dataDir);
    expect(reloaded.get('prop_fs_002')?.id).toBe('prop_fs_002');
    expect(reloaded.list()).toHaveLength(1);
  });
});
