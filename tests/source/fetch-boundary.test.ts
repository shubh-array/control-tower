import { describe, it, expect } from 'vitest';
import {
  buildFetchEnvironment,
  buildVerifyEnvironment,
  buildMirrorPath,
  type FetchBoundaryConfig,
} from '../../src/source/fetch-boundary.js';

const BASE_CONFIG: FetchBoundaryConfig = {
  dataDirectory: '/data',
  sshAuthSock: '/tmp/ssh-agent.sock',
  catalogRemote: 'git@github.com:org/pba-webapp.git',
  catalogRefspec: '+refs/pull/42/head:refs/ct/pr/42',
  homePath: '/Users/test',
};

describe('buildFetchEnvironment', () => {
  it('includes SSH_AUTH_SOCK for authenticated fetch', () => {
    const env = buildFetchEnvironment(BASE_CONFIG);
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/ssh-agent.sock');
  });

  it('includes only common safe variables plus SSH', () => {
    const env = buildFetchEnvironment(BASE_CONFIG);
    expect(env).toHaveProperty('PATH');
    expect(env).toHaveProperty('HOME');
    expect(env).toHaveProperty('SSH_AUTH_SOCK');
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env).not.toHaveProperty('CURSOR_API_KEY');
    expect(env).not.toHaveProperty('GIT_ASKPASS');
  });

  it('removes GIT_ASKPASS and SSH_ASKPASS', () => {
    const env = buildFetchEnvironment(BASE_CONFIG);
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.SSH_ASKPASS).toBeUndefined();
  });
});

describe('buildVerifyEnvironment', () => {
  it('CRITICAL: has NO SSH_AUTH_SOCK', () => {
    const env = buildVerifyEnvironment(BASE_CONFIG);
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
  });

  it('has NO credential helper access', () => {
    const env = buildVerifyEnvironment(BASE_CONFIG);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
  });

  it('disables network protocols', () => {
    const env = buildVerifyEnvironment(BASE_CONFIG);
    expect(env).not.toHaveProperty('SSH_AUTH_SOCK');
    expect(env).not.toHaveProperty('GH_TOKEN');
  });
});

describe('buildMirrorPath', () => {
  it('computes canonical mirror path under data directory', () => {
    const path = buildMirrorPath('/data', 'org', 'pba-webapp');
    expect(path).toBe('/data/mirrors/org/pba-webapp.git');
  });
});
