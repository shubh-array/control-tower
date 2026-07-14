import { createHash } from 'node:crypto';
import { buildGitLocalEnv } from '../security/child-env.js';

export interface MaterializeConfig {
  homePath: string;
  mirrorPath: string;
  jobId: string;
  dataDirectory: string;
  pathMatcherVersion: string;
  protectedPatternSetHash: string;
}

export interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  path: string;
}

export interface FilterResult {
  accepted: boolean;
  reason?: string;
  path: string;
  blobSha?: string;
}

interface PathMatcher {
  matches(path: string): boolean;
  canonicalize(path: string): string | null;
  version: string;
  contentHash: string;
}

const ALLOWED_MODES = new Set(['100644', '100755']);

export function buildMaterializeEnvironment(config: MaterializeConfig): Record<string, string> {
  return buildGitLocalEnv({
    HOME: config.homePath,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    USER: process.env.USER,
  });
}

export function buildMaterializeGitArgs(): string[] {
  return [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.attributesFile=/dev/null',
    '-c', 'credential.helper=',
    '-c', 'protocol.allow=never',
    '-c', 'submodule.recurse=false',
  ];
}

export function buildAdminWorktreeArgs(adminPath: string, headSha: string): string[] {
  return ['worktree', 'add', '--detach', adminPath, headSha];
}

export function filterTreeEntry(entry: TreeEntry, protectedMatcher: PathMatcher): FilterResult {
  const canonical = protectedMatcher.canonicalize(entry.path);
  if (canonical === null) {
    return { accepted: false, reason: 'unsafe_path', path: entry.path };
  }

  if (entry.mode === '120000') {
    return { accepted: false, reason: 'symlink', path: canonical };
  }
  if (entry.mode === '160000') {
    return { accepted: false, reason: 'submodule', path: canonical };
  }
  if (!ALLOWED_MODES.has(entry.mode)) {
    return { accepted: false, reason: 'unsupported_mode', path: canonical };
  }

  if (protectedMatcher.matches(canonical)) {
    return { accepted: false, reason: 'protected_path_content', path: canonical };
  }

  return { accepted: true, path: canonical, blobSha: entry.sha };
}

export interface SourceManifestInput {
  repositoryId: string;
  headCommit: string;
  rootTreeSha: string;
  matcherVersion: string;
  protectedPatternSetHash: string;
  allowed: Array<{ path: string; blobSha: string; size: number; mode: string; lineCount: number }>;
  omitted: Array<{ path: string; reason: string }>;
}

export interface SourceManifest {
  repositoryId: string;
  headCommit: string;
  rootTreeSha: string;
  matcherVersion: string;
  protectedPatternSetHash: string;
  contentHash: string;
  allowed: Array<{ path: string; blobSha: string; size: number; mode: string; lineCount: number }>;
  omitted: Array<{ path: string; reason: string }>;
}

export function buildSourceManifest(input: SourceManifestInput): SourceManifest {
  const hashInput = JSON.stringify({
    allowed: input.allowed.map(a => `${a.path}:${a.blobSha}:${a.size}:${a.mode}:${a.lineCount}`).sort(),
    headCommit: input.headCommit,
    matcherVersion: input.matcherVersion,
    omitted: input.omitted.map(o => `${o.path}:${o.reason}`).sort(),
    protectedPatternSetHash: input.protectedPatternSetHash,
    repositoryId: input.repositoryId,
    rootTreeSha: input.rootTreeSha,
  });

  return {
    ...input,
    contentHash: createHash('sha256').update(hashInput).digest('hex'),
  };
}

export function worktreeAdminPath(dataDirectory: string, jobId: string): string {
  return `${dataDirectory}/worktrees/${jobId}/admin`;
}

export function worktreeSourcePath(dataDirectory: string, jobId: string): string {
  return `${dataDirectory}/worktrees/${jobId}/source`;
}
