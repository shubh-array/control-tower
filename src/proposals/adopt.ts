import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../util/hash.js';

interface AdoptionTarget {
  path: string;
  baseContentHash: string;
  proposedContent: string;
  contentHash: string;
}

interface AdoptionRequest {
  profileDir: string;
  proposalId: string;
  proposalVersion: number;
  targets: AdoptionTarget[];
}

interface AdoptionResult {
  adopted: boolean;
  errors: string[];
  adoptedAt?: string;
}

const adoptedProposals = new Set<string>();

export function adoptProposal(request: AdoptionRequest): AdoptionResult {
  const proposalKey = `${request.proposalId}:${request.proposalVersion}`;

  if (adoptedProposals.has(proposalKey)) {
    return { adopted: false, errors: [`Proposal "${proposalKey}" already adopted — single-use only`] };
  }

  const errors: string[] = [];
  const verified: { fullPath: string; content: string }[] = [];

  for (const target of request.targets) {
    const fullPath = join(request.profileDir, target.path);
    let currentContent: string;
    try {
      currentContent = readFileSync(fullPath, 'utf-8');
    } catch {
      errors.push(`Target "${target.path}" does not exist at "${fullPath}"`);
      continue;
    }
    const currentHash = sha256Hex(currentContent);
    if (currentHash !== target.baseContentHash) {
      errors.push(`Target "${target.path}" base hash is stale: current=${currentHash}, expected=${target.baseContentHash}`);
    } else {
      verified.push({ fullPath, content: target.proposedContent });
    }
  }

  if (errors.length > 0) {
    return { adopted: false, errors };
  }

  for (const { fullPath, content } of verified) {
    writeFileSync(fullPath, content, 'utf-8');
  }

  adoptedProposals.add(proposalKey);
  return { adopted: true, errors: [], adoptedAt: new Date().toISOString() };
}

export function resetAdoptionState(): void {
  adoptedProposals.clear();
}
