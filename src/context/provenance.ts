import { createHash } from 'node:crypto';

function base32Encode(buffer: Buffer): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

function makeProvenanceId(canonicalInput: string): string {
  const hash = createHash('sha256').update(canonicalInput).digest();
  return `pv_${base32Encode(hash)}`;
}

export interface ProvenanceRecord {
  id: string;
  type: 'diff_hunk' | 'check' | 'comment' | 'commit';
  data: Record<string, unknown>;
}

export interface DiffHunkInput {
  repositoryId: string;
  baseSha: string;
  headSha: string;
  canonicalPath: string;
  hunkHash: string;
  leftRange: { start: number; end: number };
  rightRange: { start: number; end: number };
}

export function createDiffHunkRecord(input: DiffHunkInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    baseSha: input.baseSha,
    canonicalPath: input.canonicalPath,
    headSha: input.headSha,
    hunkHash: input.hunkHash,
    leftRange: input.leftRange,
    repositoryId: input.repositoryId,
    rightRange: input.rightRange,
    type: 'diff_hunk',
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'diff_hunk',
    data: { ...input },
  };
}

export interface CheckInput {
  checkRunId: number;
  attempt: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  observedAt: string;
}

export function createCheckRecord(input: CheckInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    attempt: input.attempt,
    checkRunId: input.checkRunId,
    conclusion: input.conclusion,
    name: input.name,
    observedAt: input.observedAt,
    status: input.status,
    type: 'check',
    url: input.url,
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'check',
    data: { ...input },
  };
}

export interface CommentInput {
  nodeId: string;
  databaseId: number;
  authorLogin: string;
  bodyHash: string;
  commitAssociation: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createCommentRecord(input: CommentInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    authorLogin: input.authorLogin,
    bodyHash: input.bodyHash,
    commitAssociation: input.commitAssociation,
    createdAt: input.createdAt,
    databaseId: input.databaseId,
    nodeId: input.nodeId,
    type: 'comment',
    updatedAt: input.updatedAt,
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'comment',
    data: { ...input },
  };
}

export interface CommitInput {
  repositoryId: string;
  commitSha: string;
}

export function createCommitRecord(input: CommitInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    commitSha: input.commitSha,
    repositoryId: input.repositoryId,
    type: 'commit',
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'commit',
    data: { ...input },
  };
}

export function validateProvenanceRef(ref: string, catalog: Map<string, ProvenanceRecord>): boolean {
  if (!ref.startsWith('pv_')) return false;
  return catalog.has(ref);
}
