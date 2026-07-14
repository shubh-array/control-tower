export interface RemoteResolutionDeps {
  queryRepository: (repositoryKey: string) => {
    github_owner: string;
    github_repo: string;
  } | null;
  catalogRepositories: Array<{ id: string; github: string }>;
}

export interface ResolvedRemote {
  owner: string;
  repo: string;
  remote: string;
}

export function resolveGithubRemote(
  deps: RemoteResolutionDeps,
  repositoryKey: string,
): ResolvedRemote | null {
  const dbRow = deps.queryRepository(repositoryKey);
  if (dbRow) {
    return {
      owner: dbRow.github_owner,
      repo: dbRow.github_repo,
      remote: `git@github.com:${dbRow.github_owner}/${dbRow.github_repo}.git`,
    };
  }

  const catalogEntry = deps.catalogRepositories.find(
    (r) => r.id === repositoryKey,
  );
  if (catalogEntry) {
    const parts = catalogEntry.github.split("/");
    if (parts.length === 2) {
      return {
        owner: parts[0]!,
        repo: parts[1]!,
        remote: `git@github.com:${catalogEntry.github}.git`,
      };
    }
  }

  const slashParts = repositoryKey.split("/");
  if (slashParts.length >= 2) {
    const owner = slashParts[slashParts.length - 2]!;
    const repo = slashParts[slashParts.length - 1]!;
    return { owner, repo, remote: `git@github.com:${owner}/${repo}.git` };
  }

  return null;
}
