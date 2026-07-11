import { describe, it, expect } from 'vitest';
import {
  buildMaterializeEnvironment,
  buildAdminWorktreeArgs,
  filterTreeEntry,
  buildSourceManifest,
  type TreeEntry,
  type MaterializeConfig,
} from '../../src/source/materialize.js';

const BASE_CONFIG: MaterializeConfig = {
  homePath: '/Users/test',
  mirrorPath: '/data/mirrors/org/repo.git',
  jobId: 'job-123',
  dataDirectory: '/data',
  pathMatcherVersion: 'v1',
  protectedPatternSetHash: 'pphash-abc',
};

describe('buildMaterializeEnvironment', () => {
  it('CRITICAL: has NO SSH_AUTH_SOCK', () => {
    const env = buildMaterializeEnvironment(BASE_CONFIG);
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
    expect(env).not.toHaveProperty('SSH_AUTH_SOCK');
  });

  it('CRITICAL: has NO credential helpers', () => {
    const env = buildMaterializeEnvironment(BASE_CONFIG);
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env).not.toHaveProperty('GIT_ASKPASS');
    expect(env).not.toHaveProperty('SSH_ASKPASS');
  });

  it('disables system/global config', () => {
    const env = buildMaterializeEnvironment(BASE_CONFIG);
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(env.GIT_ATTR_NOSYSTEM).toBe('1');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });
});

describe('buildAdminWorktreeArgs', () => {
  it('uses --detach --no-checkout', () => {
    const args = buildAdminWorktreeArgs('/data/worktrees/job-123/admin');
    expect(args).toContain('--detach');
    expect(args).toContain('--no-checkout');
    expect(args).not.toContain('checkout');
  });
});

describe('filterTreeEntry', () => {
  const protectedMatcher = { matches: (p: string) => p.startsWith('.env'), canonicalize: (p: string) => p, version: 'v1', contentHash: 'h' };

  it('accepts regular blob mode 100644', () => {
    const entry: TreeEntry = { mode: '100644', type: 'blob', sha: 'abc', path: 'src/index.ts' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(true);
  });

  it('accepts executable blob mode 100755', () => {
    const entry: TreeEntry = { mode: '100755', type: 'blob', sha: 'abc', path: 'scripts/build.sh' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(true);
  });

  it('rejects symlinks', () => {
    const entry: TreeEntry = { mode: '120000', type: 'blob', sha: 'abc', path: 'link' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('symlink');
  });

  it('rejects gitlinks/submodules', () => {
    const entry: TreeEntry = { mode: '160000', type: 'commit', sha: 'abc', path: 'vendor/lib' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('submodule');
  });

  it('rejects protected paths and retains only path + reason', () => {
    const entry: TreeEntry = { mode: '100644', type: 'blob', sha: 'abc', path: '.env.local' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('protected_path_content');
    expect(result).not.toHaveProperty('blobSha');
  });
});

describe('buildSourceManifest', () => {
  it('records allowed entries with path, sha, size, mode', () => {
    const allowed = [
      { path: 'src/a.ts', blobSha: 'sha-a', size: 100, mode: '100644' },
    ];
    const omitted = [
      { path: '.env', reason: 'protected_path_content' },
    ];
    const manifest = buildSourceManifest({
      repositoryId: 'pba-webapp',
      headCommit: 'commit-sha',
      rootTreeSha: 'tree-sha',
      matcherVersion: 'v1',
      protectedPatternSetHash: 'pphash',
      allowed,
      omitted,
    });
    expect(manifest.allowed).toHaveLength(1);
    expect(manifest.omitted).toHaveLength(1);
    expect(manifest.omitted[0]).not.toHaveProperty('blobSha');
  });
});
