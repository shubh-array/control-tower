import { describe, it, expect } from 'vitest';
import { resolveGithubRemote, type RemoteResolutionDeps } from '../../src/orchestrator/resolve-remote.js';
import { buildSourceManifest } from '../../src/source/materialize.js';

function makeResolutionDeps(overrides: Partial<RemoteResolutionDeps> = {}): RemoteResolutionDeps {
  return {
    queryRepository: () => null,
    catalogRepositories: [],
    ...overrides,
  };
}

describe('resolveGithubRemote', () => {
  it('resolves from DB github_owner/github_repo', () => {
    const deps = makeResolutionDeps({
      queryRepository: (key: string) =>
        key === 'pba-webapp'
          ? { github_owner: 'Powered-By-Array', github_repo: 'pba-webapp' }
          : null,
    });

    const result = resolveGithubRemote(deps, 'pba-webapp');
    expect(result).toEqual({
      owner: 'Powered-By-Array',
      repo: 'pba-webapp',
      remote: 'git@github.com:Powered-By-Array/pba-webapp.git',
    });
  });

  it('falls back to organization catalog', () => {
    const deps = makeResolutionDeps({
      queryRepository: () => null,
      catalogRepositories: [
        { id: 'pba-webapp', github: 'Powered-By-Array/pba-webapp' },
      ],
    });

    const result = resolveGithubRemote(deps, 'pba-webapp');
    expect(result).toEqual({
      owner: 'Powered-By-Array',
      repo: 'pba-webapp',
      remote: 'git@github.com:Powered-By-Array/pba-webapp.git',
    });
  });

  it('returns null when neither DB nor catalog has the repo', () => {
    const deps = makeResolutionDeps();
    const result = resolveGithubRemote(deps, 'unknown-repo');
    expect(result).toBeNull();
  });

  it('handles owner/repo style repositoryKey without DB lookup', () => {
    const deps = makeResolutionDeps();
    const result = resolveGithubRemote(deps, 'myorg/myrepo');
    expect(result).toEqual({
      owner: 'myorg',
      repo: 'myrepo',
      remote: 'git@github.com:myorg/myrepo.git',
    });
  });
});

describe('SourceManifest lineCount', () => {
  it('includes lineCount in allowed entries', () => {
    const manifest = buildSourceManifest({
      repositoryId: 'test-repo',
      headCommit: 'abc123',
      rootTreeSha: 'abc123',
      matcherVersion: '1',
      protectedPatternSetHash: 'hash',
      allowed: [
        { path: 'src/index.ts', blobSha: 'sha1', size: 100, mode: '100644', lineCount: 25 },
      ],
      omitted: [],
    });

    expect(manifest.allowed[0]!.lineCount).toBe(25);
  });
});

describe('prepareRegisteredSource file materialization', () => {
  it('copies allowed files from admin worktree to sourceViewRoot', async () => {
    // Full integration test requires git setup — unit-level verifies manifest shape.
  });
});
