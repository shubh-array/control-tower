import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  /** When set, adoption single-use state is persisted under data/proposals/adopted/ */
  dataDirectory?: string;
}

interface AdoptionResult {
  adopted: boolean;
  errors: string[];
  adoptedAt?: string;
}

const adoptedProposals = new Set<string>();

function proposalKey(proposalId: string, proposalVersion: number): string {
  return `${proposalId}:${proposalVersion}`;
}

function adoptedDir(dataDirectory: string): string {
  const dir = join(dataDirectory, 'proposals', 'adopted');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function adoptedMarkerPath(dataDirectory: string, key: string): string {
  return join(adoptedDir(dataDirectory), `${key.replace(/:/g, '_')}.json`);
}

function isAdoptedPersisted(dataDirectory: string, key: string): boolean {
  return existsSync(adoptedMarkerPath(dataDirectory, key));
}

function markAdoptedPersisted(
  dataDirectory: string,
  key: string,
  adoptedAt: string,
): void {
  writeFileSync(
    adoptedMarkerPath(dataDirectory, key),
    JSON.stringify({ proposalKey: key, adoptedAt }, null, 2),
    'utf-8',
  );
}

function hasBeenAdopted(request: AdoptionRequest): boolean {
  const key = proposalKey(request.proposalId, request.proposalVersion);
  if (adoptedProposals.has(key)) return true;
  if (request.dataDirectory && isAdoptedPersisted(request.dataDirectory, key)) {
    adoptedProposals.add(key);
    return true;
  }
  return false;
}

export function adoptProposal(request: AdoptionRequest): AdoptionResult {
  const key = proposalKey(request.proposalId, request.proposalVersion);

  if (hasBeenAdopted(request)) {
    return { adopted: false, errors: [`Proposal "${key}" already adopted — single-use only`] };
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

  const adoptedAt = new Date().toISOString();
  adoptedProposals.add(key);
  if (request.dataDirectory) {
    markAdoptedPersisted(request.dataDirectory, key, adoptedAt);
  }
  return { adopted: true, errors: [], adoptedAt };
}

export function resetAdoptionState(): void {
  adoptedProposals.clear();
}
