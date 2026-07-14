import { buildGitFetchEnv, buildGitLocalEnv } from '../security/child-env.js';

export interface FetchBoundaryConfig {
  dataDirectory: string;
  sshAuthSock: string | undefined;
  catalogRemote: string;
  catalogRefspec: string;
  homePath: string;
}

function hostFromConfig(config: FetchBoundaryConfig): Record<string, string | undefined> {
  const host: Record<string, string | undefined> = {
    HOME: config.homePath,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    USER: process.env.USER,
  };
  if (config.sshAuthSock) {
    host.SSH_AUTH_SOCK = config.sshAuthSock;
  }
  return host;
}

export function buildFetchEnvironment(config: FetchBoundaryConfig): Record<string, string> {
  return buildGitFetchEnv(hostFromConfig(config), { useSSH: true });
}

export function buildVerifyEnvironment(config: FetchBoundaryConfig): Record<string, string> {
  return buildGitLocalEnv(hostFromConfig(config));
}

export function buildFetchGitArgs(): string[] {
  return [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'credential.helper=',
    '-c', 'submodule.recurse=false',
  ];
}

export function buildFetchArgs(config: FetchBoundaryConfig, _mirrorPath: string): string[] {
  return [
    'fetch',
    '--no-tags',
    '--no-recurse-submodules',
    config.catalogRemote,
    config.catalogRefspec,
  ];
}

export function buildMirrorPath(dataDirectory: string, owner: string, repo: string): string {
  return `${dataDirectory}/mirrors/${owner}/${repo}.git`;
}

export function buildVerifyArgs(_expectedSha: string, ctRef: string): string[] {
  return ['rev-parse', '--verify', ctRef];
}
