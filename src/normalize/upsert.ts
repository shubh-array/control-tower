import type Database from "better-sqlite3";
import { normalizeLogin } from "../config/author-login.js";
import type { DiscoveredPr, GhCheckRun } from "../github/types.js";
import type { PolicyDecision } from "../policy/evaluate.js";
import { canonicalJsonSerialize } from "../util/canonical-json.js";
import { sha256OfCanonicalJson } from "../util/hash.js";

type ResourceClass = "light" | "medium" | "heavy";

interface RepositoryUpsertInput {
  id: string;
  github: string;
  defaultBranch: string;
  host: string;
  resourceClass: ResourceClass;
}

type CommentRecord = DiscoveredPr["comments"][number];

export function upsertRepository(
  db: Database.Database,
  repo: RepositoryUpsertInput,
): void {
  const { owner, name } = splitGithubRepo(repo.github);
  const githubIdentity = `github:${repo.host}/${owner}/${name}`;

  db.prepare(
    `
      INSERT INTO repositories (
        id, github_identity, github_host, github_owner, github_repo,
        default_branch, resource_class, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(id) DO UPDATE SET
        github_identity = excluded.github_identity,
        github_host = excluded.github_host,
        github_owner = excluded.github_owner,
        github_repo = excluded.github_repo,
        default_branch = excluded.default_branch,
        resource_class = excluded.resource_class,
        updated_at = excluded.updated_at
    `,
  ).run(
    repo.id,
    githubIdentity,
    repo.host,
    owner,
    name,
    repo.defaultBranch,
    repo.resourceClass,
  );
}

export function upsertEligiblePr(
  db: Database.Database,
  pr: DiscoveredPr,
  decision: PolicyDecision,
): number {
  const policyJson = canonicalJsonSerialize(decision);
  const policyHash = sha256OfCanonicalJson(decision);

  const transaction = db.transaction(() => {
    const row = db
      .prepare(
        `
          INSERT INTO prs (
            repository_id, pr_number, head_sha, base_sha, title, url,
            author_login, explicit_request, explicit_request_at, github_updated,
            policy_json, policy_hash, fetched_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT(repository_id, pr_number) DO UPDATE SET
            head_sha = excluded.head_sha,
            base_sha = excluded.base_sha,
            title = excluded.title,
            url = excluded.url,
            author_login = excluded.author_login,
            explicit_request = MAX(prs.explicit_request, excluded.explicit_request),
            explicit_request_at = COALESCE(prs.explicit_request_at, excluded.explicit_request_at),
            github_updated = excluded.github_updated,
            policy_json = excluded.policy_json,
            policy_hash = excluded.policy_hash,
            fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          RETURNING id
        `,
      )
      .get(
        pr.repositoryId,
        pr.prNumber,
        pr.headSha,
        pr.baseSha,
        pr.title,
        pr.url,
        normalizeLogin(pr.authorLogin),
        pr.explicitRequest ? 1 : 0,
        pr.explicitRequestTimestamp ?? null,
        pr.updatedAt,
        policyJson,
        policyHash,
      ) as { id: number };

    upsertPrChecks(db, row.id, pr.checks);
    upsertPrComments(db, row.id, pr.comments);
    return row.id;
  });

  return transaction();
}

export function deleteReviewPr(
  db: Database.Database,
  repositoryId: string,
  prNumber: number,
): void {
  db.prepare(
    "DELETE FROM prs WHERE repository_id = ? AND pr_number = ?",
  ).run(repositoryId, prNumber);
}

function upsertPrChecks(
  db: Database.Database,
  prId: number,
  checks: GhCheckRun[],
): void {
  db.prepare("DELETE FROM pr_checks WHERE pr_id = ?").run(prId);

  const insertCheck = db.prepare(
    `
      INSERT INTO pr_checks (pr_id, name, status, conclusion, details_url)
      VALUES (?, ?, ?, ?, ?)
    `,
  );

  // GitHub statusCheckRollup can repeat the same check name across contexts.
  const byName = new Map<string, GhCheckRun>();
  for (const check of checks) {
    if (!check.name) continue;
    byName.set(check.name, check);
  }

  for (const check of byName.values()) {
    insertCheck.run(
      prId,
      check.name,
      check.status,
      check.conclusion,
      check.detailsUrl,
    );
  }
}

function upsertPrComments(
  db: Database.Database,
  prId: number,
  comments: CommentRecord[],
): void {
  db.prepare("DELETE FROM pr_comments WHERE pr_id = ?").run(prId);

  const insertComment = db.prepare(
    `
      INSERT INTO pr_comments (pr_id, author_login, body, created_at, url)
      VALUES (?, ?, ?, ?, ?)
    `,
  );

  for (const comment of comments) {
    insertComment.run(
      prId,
      normalizeLogin(comment.authorLogin),
      comment.body,
      comment.createdAt,
      comment.url,
    );
  }
}

function splitGithubRepo(github: string): { owner: string; name: string } {
  const [owner, name, ...rest] = github.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`Invalid GitHub repository slug "${github}"`);
  }

  return { owner, name };
}
