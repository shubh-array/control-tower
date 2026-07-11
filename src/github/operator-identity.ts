import { normalizeLogin } from "../config/author-login.js";
import type { GhExecOptions } from "./gh-process.js";
import type { HostHealth } from "./types.js";

type ExecGhTextFn = (args: string[], options: GhExecOptions) => Promise<string>;

export async function verifyOperatorIdentity(
  host: string,
  configuredLogin: string,
  execGhTextFn: ExecGhTextFn,
): Promise<HostHealth> {
  const checkedAt = new Date().toISOString();

  try {
    const normalizedConfiguredLogin = normalizeLogin(configuredLogin);
    const rawLogin = await execGhTextFn(
      ["api", "--hostname", host, "user", "--jq", ".login"],
      { host },
    );
    const authenticatedLogin = normalizeLogin(rawLogin);

    if (authenticatedLogin !== normalizedConfiguredLogin) {
      return {
        host,
        healthy: false,
        authenticatedLogin,
        error: `Login mismatch: authenticated as "${authenticatedLogin}" but configured as "${normalizedConfiguredLogin}"`,
        checkedAt,
      };
    }

    return {
      host,
      healthy: true,
      authenticatedLogin,
      checkedAt,
    };
  } catch (err) {
    return {
      host,
      healthy: false,
      authenticatedLogin: null,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}
