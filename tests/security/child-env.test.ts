import { describe, it, expect } from "vitest";
import {
  buildCommonEnv,
  buildCursorEnv,
  buildGhEnv,
  buildGitFetchEnv,
  buildGitLocalEnv,
} from "../../src/security/child-env.js";

const hostEnv: Record<string, string> = {
  PATH: "/usr/bin:/usr/local/bin",
  HOME: "/Users/test",
  TMPDIR: "/tmp",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  USER: "test",
  CURSOR_API_KEY: "secret-key",
  CURSOR_AUTH_TOKEN: "secret-token",
  GH_TOKEN: "ghp_secret",
  GITHUB_TOKEN: "ghp_secret2",
  GH_HOST: "github.com",
  GH_CONFIG_DIR: "/home/.config/gh",
  GH_ENTERPRISE_TOKEN: "ghe_secret",
  SSH_AUTH_SOCK: "/tmp/ssh.sock",
  GIT_ASKPASS: "/usr/bin/askpass",
  SSH_ASKPASS: "/usr/bin/ssh-askpass",
  GIT_SSH_COMMAND: "ssh -i /tmp/key",
  NODE_ENV: "development",
  SOME_SECRET: "value",
};

describe("buildCommonEnv", () => {
  it("includes only allowed common variables", () => {
    const env = buildCommonEnv(hostEnv);
    expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
    expect(env.HOME).toBe("/Users/test");
    expect(env.TMPDIR).toBe("/tmp");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.LC_ALL).toBe("en_US.UTF-8");
    expect(env.USER).toBe("test");
  });

  it("omits non-common variables", () => {
    const env = buildCommonEnv(hostEnv);
    expect(env).not.toHaveProperty("NODE_ENV");
    expect(env).not.toHaveProperty("SOME_SECRET");
    expect(env).not.toHaveProperty("GH_TOKEN");
  });

  it("omits missing optional variables", () => {
    const env = buildCommonEnv({ PATH: "/usr/bin" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env).not.toHaveProperty("HOME");
  });
});

describe("buildCursorEnv", () => {
  it("uses common vars only (plus optional CURSOR_API_KEY)", () => {
    const env = buildCursorEnv(hostEnv);
    expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
    expect(env.HOME).toBe("/Users/test");
  });

  it("passes CURSOR_API_KEY when set for isolated-HOME headless auth", () => {
    const env = buildCursorEnv(hostEnv);
    expect(env.CURSOR_API_KEY).toBe("secret-key");
  });

  it("omits CURSOR_API_KEY when unset and still removes CURSOR_AUTH_TOKEN", () => {
    const { CURSOR_API_KEY: _k, ...withoutKey } = hostEnv;
    const env = buildCursorEnv(withoutKey);
    expect(env).not.toHaveProperty("CURSOR_API_KEY");
    expect(env).not.toHaveProperty("CURSOR_AUTH_TOKEN");
  });

  it("removes GitHub tokens", () => {
    const env = buildCursorEnv(hostEnv);
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
  });
});

describe("buildGhEnv", () => {
  it("includes common vars plus GH_HOST and GH_CONFIG_DIR", () => {
    const env = buildGhEnv(hostEnv, { host: "github.com", configDir: "/home/.config/gh" });
    expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
    expect(env.GH_HOST).toBe("github.com");
    expect(env.GH_CONFIG_DIR).toBe("/home/.config/gh");
  });

  it("removes GH_TOKEN, GITHUB_TOKEN, and all other GH_* from host", () => {
    const env = buildGhEnv(hostEnv, { host: "github.com" });
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GH_ENTERPRISE_TOKEN");
  });

  it("omits GH_CONFIG_DIR when not configured", () => {
    const env = buildGhEnv(hostEnv, { host: "github.com" });
    expect(env).not.toHaveProperty("GH_CONFIG_DIR");
  });
});

describe("buildGitFetchEnv", () => {
  it("includes SSH_AUTH_SOCK for SSH fetch", () => {
    const env = buildGitFetchEnv(hostEnv, { useSSH: true });
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
  });

  it("removes token and askpass variables", () => {
    const env = buildGitFetchEnv(hostEnv, { useSSH: true });
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GIT_ASKPASS");
    expect(env).not.toHaveProperty("SSH_ASKPASS");
    expect(env).not.toHaveProperty("GIT_SSH_COMMAND");
  });
});

describe("buildGitLocalEnv", () => {
  it("sets hardened Git config variables", () => {
    const env = buildGitLocalEnv(hostEnv);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(env.GIT_ATTR_NOSYSTEM).toBe("1");
  });

  it("removes SSH_AUTH_SOCK", () => {
    const env = buildGitLocalEnv(hostEnv);
    expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
  });

  it("removes all credential-related variables", () => {
    const env = buildGitLocalEnv(hostEnv);
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GIT_ASKPASS");
    expect(env).not.toHaveProperty("SSH_ASKPASS");
    expect(env).not.toHaveProperty("CURSOR_API_KEY");
  });
});
