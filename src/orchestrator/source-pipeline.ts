import { execFile } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeSync, closeSync, fsyncSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { CanonicalPathMatcher } from "../paths/matcher.js";
import {
  buildFetchArgs,
  buildFetchEnvironment,
  buildMirrorPath,
  buildVerifyArgs,
  buildVerifyEnvironment,
  type FetchBoundaryConfig,
} from "../source/fetch-boundary.js";
import {
  buildAdminWorktreeArgs,
  buildMaterializeEnvironment,
  buildMaterializeGitArgs,
  buildSourceManifest,
  filterTreeEntry,
  worktreeAdminPath,
  worktreeSourcePath,
  type SourceManifest,
  type TreeEntry,
} from "../source/materialize.js";
import { SourceFetchError, SourceMaterializeError } from "../source/errors.js";

const execFileAsync = promisify(execFile);

export interface SourcePipelineInput {
  dataDirectory: string;
  jobId: string;
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  repositoryPath?: string;
  githubRemote?: string;
  homePath: string;
  sshAuthSock?: string;
  protectedPaths: string[];
}

export interface SourcePipelineResult {
  sourceViewRoot: string;
  adminWorktree: string;
  sourceManifest: SourceManifest;
}

function writeCreateOnceSync(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const fd = openSync(filePath, "wx");
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function parseGithubOwnerRepo(
  repositoryKey: string,
  githubRemote?: string,
): { owner: string; repo: string; remote: string } {
  if (githubRemote) {
    const match = /[:/]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(githubRemote);
    if (match) {
      return {
        owner: match[1]!,
        repo: match[2]!,
        remote: githubRemote,
      };
    }
  }

  const parts = repositoryKey.split("/");
  if (parts.length >= 2) {
    const repo = parts[parts.length - 1]!;
    const owner = parts[parts.length - 2]!;
    return {
      owner,
      repo,
      remote: `git@github.com:${owner}/${repo}.git`,
    };
  }

  return {
    owner: "unknown",
    repo: repositoryKey,
    remote: `git@github.com:unknown/${repositoryKey}.git`,
  };
}

async function runGit(
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    env: { ...process.env, ...env },
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function buildProtectedMatcher(protectedPaths: string[]): CanonicalPathMatcher {
  return CanonicalPathMatcher.compile(
    protectedPaths.map((pattern) => ({
      pattern,
      source: "organization.security.protectedPaths",
    })),
  );
}

async function fetchMirror(
  config: FetchBoundaryConfig,
  mirrorPath: string,
): Promise<void> {
  if (!existsSync(mirrorPath)) {
    mkdirSync(dirname(mirrorPath), { recursive: true });
    await runGit(
      ["init", "--bare", mirrorPath],
      buildVerifyEnvironment(config),
    );
  }

  await runGit(
    [
      ...buildMaterializeGitArgs(),
      "-C",
      mirrorPath,
      ...buildFetchArgs(config, mirrorPath),
    ],
    buildFetchEnvironment(config),
  );
}

async function verifyHeadSha(
  config: FetchBoundaryConfig,
  mirrorPath: string,
  headSha: string,
  prNumber: number,
): Promise<void> {
  const ctRef = `refs/ct/pr/${prNumber}`;
  const resolved = await runGit(
    [
      ...buildMaterializeGitArgs(),
      "-C",
      mirrorPath,
      ...buildVerifyArgs(headSha, ctRef),
    ],
    buildVerifyEnvironment(config),
  );
  if (resolved !== headSha) {
    throw new SourceFetchError(
      `verified SHA ${resolved} does not match expected ${headSha}`,
    );
  }
}

async function listTreeAtCommit(
  materializeEnv: Record<string, string>,
  mirrorPath: string,
  headSha: string,
): Promise<TreeEntry[]> {
  const output = await runGit(
    [
      ...buildMaterializeGitArgs(),
      "-C",
      mirrorPath,
      "ls-tree",
      "-r",
      headSha,
    ],
    materializeEnv,
  );

  const entries: TreeEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const match = /^(\d+) (\S+) (\S+)\t(.+)$/.exec(line);
    if (!match) continue;
    entries.push({
      mode: match[1]!,
      type: match[2]!,
      sha: match[3]!,
      path: match[4]!,
    });
  }
  return entries;
}

export async function prepareRegisteredSource(
  input: SourcePipelineInput,
): Promise<SourcePipelineResult> {
  if (!input.repositoryPath || !existsSync(input.repositoryPath)) {
    throw new SourceFetchError(
      `registered repository path not configured for ${input.repositoryKey}`,
    );
  }

  const { owner, repo, remote } = parseGithubOwnerRepo(
    input.repositoryKey,
    input.githubRemote,
  );
  const mirrorPath = buildMirrorPath(input.dataDirectory, owner, repo);
  const adminPath = worktreeAdminPath(input.dataDirectory, input.jobId);
  const sourcePath = worktreeSourcePath(input.dataDirectory, input.jobId);
  const protectedMatcher = buildProtectedMatcher(input.protectedPaths);

  const fetchConfig: FetchBoundaryConfig = {
    dataDirectory: input.dataDirectory,
    sshAuthSock: input.sshAuthSock ?? process.env.SSH_AUTH_SOCK,
    catalogRemote: remote,
    catalogRefspec: `+refs/pull/${input.prNumber}/head:refs/ct/pr/${input.prNumber}`,
    homePath: input.homePath,
  };

  try {
    await fetchMirror(fetchConfig, mirrorPath);
    await verifyHeadSha(fetchConfig, mirrorPath, input.headSha, input.prNumber);
  } catch (err) {
    if (err instanceof SourceFetchError || err instanceof SourceMaterializeError) {
      throw err;
    }
    throw new SourceFetchError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const materializeConfig = {
    homePath: input.homePath,
    mirrorPath,
    jobId: input.jobId,
    dataDirectory: input.dataDirectory,
    pathMatcherVersion: String(protectedMatcher.version),
    protectedPatternSetHash: protectedMatcher.contentHash,
  };
  const materializeEnv = buildMaterializeEnvironment(materializeConfig);

  try {
    mkdirSync(dirname(adminPath), { recursive: true });
    if (!existsSync(adminPath)) {
      await runGit(
        [
          ...buildMaterializeGitArgs(),
          "-C",
          mirrorPath,
          ...buildAdminWorktreeArgs(adminPath),
        ],
        materializeEnv,
      );
    }

    await runGit(
      [
        ...buildMaterializeGitArgs(),
        "-C",
        adminPath,
        "checkout",
        "--force",
        input.headSha,
      ],
      materializeEnv,
    );

    const treeEntries = await listTreeAtCommit(
      materializeEnv,
      mirrorPath,
      input.headSha,
    );
    const allowed: Array<{
      path: string;
      blobSha: string;
      size: number;
      mode: string;
    }> = [];
    const omitted: Array<{ path: string; reason: string }> = [];

    for (const entry of treeEntries) {
      const filtered = filterTreeEntry(entry, {
        matches: (path) => protectedMatcher.matches(path),
        canonicalize: (path) => protectedMatcher.canonicalize(path),
        version: String(protectedMatcher.version),
        contentHash: protectedMatcher.contentHash,
      });
      if (filtered.accepted && filtered.blobSha) {
        allowed.push({
          path: filtered.path,
          blobSha: filtered.blobSha,
          size: 0,
          mode: entry.mode,
        });
      } else if (!filtered.accepted && filtered.reason) {
        omitted.push({ path: filtered.path, reason: filtered.reason });
      }
    }

    mkdirSync(sourcePath, { recursive: true });
    const sourceManifest = buildSourceManifest({
      repositoryId: input.repositoryKey,
      headCommit: input.headSha,
      rootTreeSha: input.headSha,
      matcherVersion: String(protectedMatcher.version),
      protectedPatternSetHash: protectedMatcher.contentHash,
      allowed,
      omitted,
    });

    writeCreateOnceSync(
      join(sourcePath, "source-manifest.json"),
      JSON.stringify(sourceManifest, null, 2),
    );

    return {
      sourceViewRoot: sourcePath,
      adminWorktree: adminPath,
      sourceManifest,
    };
  } catch (err) {
    if (err instanceof SourceMaterializeError) throw err;
    throw new SourceMaterializeError(
      err instanceof Error ? err.message : String(err),
    );
  }
}
