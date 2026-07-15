const COMMON_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER"] as const;

export function buildCommonEnv(
  host: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of COMMON_KEYS) {
    const val = host[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

export function buildCursorEnv(
  host: Record<string, string | undefined>,
): Record<string, string> {
  const env = buildCommonEnv(host);
  // Headless auth under an isolated Control Tower Cursor HOME.
  if (host.CURSOR_API_KEY !== undefined && host.CURSOR_API_KEY !== "") {
    env.CURSOR_API_KEY = host.CURSOR_API_KEY;
  }
  return env;
}

interface GhEnvOptions {
  host: string;
  configDir?: string;
}

export function buildGhEnv(
  host: Record<string, string | undefined>,
  opts: GhEnvOptions,
): Record<string, string> {
  const env = buildCommonEnv(host);
  env.GH_HOST = opts.host;
  if (opts.configDir) {
    env.GH_CONFIG_DIR = opts.configDir;
  }
  return env;
}

interface GitFetchEnvOptions {
  useSSH: boolean;
}

export function buildGitFetchEnv(
  host: Record<string, string | undefined>,
  opts: GitFetchEnvOptions,
): Record<string, string> {
  const env = buildCommonEnv(host);
  if (opts.useSSH && host.SSH_AUTH_SOCK) {
    env.SSH_AUTH_SOCK = host.SSH_AUTH_SOCK;
  }
  return env;
}

export function buildGitLocalEnv(
  host: Record<string, string | undefined>,
): Record<string, string> {
  const env = buildCommonEnv(host);
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_ATTR_NOSYSTEM = "1";
  return env;
}
