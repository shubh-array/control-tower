import type Database from "better-sqlite3";
import { normalizeLogin } from "../config/author-login.js";
import type { DiscoveredPr, GhCheckRun } from "../github/types.js";

type ResourceClass = "light" | "medium" | "heavy";

interface RepositoryUpsertInput {
  id: string;
  github: string;
  defaultBranch: string;
  host: string;
  resourceClass: ResourceClass;
}

interface UnsafeFileRecord {
  raw: string;
  diagnostic: string;
}

type ReviewRecord = DiscoveredPr["reviews"][number];
type CommentRecord = DiscoveredPr["comments"][number];
type ReviewRequestRecord = DiscoveredPr["reviewRequests"][number];

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

export function upsertPr(db: Database.Database, pr: DiscoveredPr): number {
  const row = db
    .prepare(
      `
        INSERT INTO prs (
          repository_id, pr_number, title, body, url, state, draft,
          author_login, head_sha, base_sha, head_ref, base_ref,
          additions, deletions, github_created, github_updated,
          explicit_request, explicit_request_at, fetched_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(repository_id, pr_number) DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          url = excluded.url,
          state = excluded.state,
          draft = excluded.draft,
          author_login = excluded.author_login,
          head_sha = excluded.head_sha,
          base_sha = excluded.base_sha,
          head_ref = excluded.head_ref,
          base_ref = excluded.base_ref,
          additions = excluded.additions,
          deletions = excluded.deletions,
          github_created = excluded.github_created,
          github_updated = excluded.github_updated,
          explicit_request = MAX(prs.explicit_request, excluded.explicit_request),
          explicit_request_at = COALESCE(prs.explicit_request_at, excluded.explicit_request_at),
          fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        RETURNING id
      `,
    )
    .get(
      pr.repositoryId,
      pr.prNumber,
      pr.title,
      pr.body ?? null,
      pr.url,
      pr.state.toLowerCase(),
      pr.isDraft ? 1 : 0,
      normalizeLogin(pr.authorLogin),
      pr.headSha,
      pr.baseSha,
      pr.headRef ?? null,
      pr.baseRef ?? null,
      pr.additions,
      pr.deletions,
      pr.createdAt,
      pr.updatedAt,
      pr.explicitRequest ? 1 : 0,
      pr.explicitRequestTimestamp ?? null,
    ) as { id: number };

  return row.id;
}

export function upsertPrFiles(
  db: Database.Database,
  prId: number,
  canonicalPaths: string[],
  unsafeFiles: UnsafeFileRecord[],
): void {
  db.prepare("DELETE FROM pr_files WHERE pr_id = ?").run(prId);

  const insertFile = db.prepare(
    `
      INSERT INTO pr_files (pr_id, path, is_unsafe, unsafe_diagnostic)
      VALUES (?, ?, ?, ?)
    `,
  );

  for (const path of canonicalPaths) {
    insertFile.run(prId, path, 0, null);
  }

  for (const unsafeFile of unsafeFiles) {
    insertFile.run(prId, unsafeFile.raw, 1, unsafeFile.diagnostic);
  }
}

export function upsertPrChecks(
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

  for (const check of checks) {
    insertCheck.run(
      prId,
      check.name,
      check.status,
      check.conclusion,
      check.detailsUrl,
    );
  }
}

export function upsertPrReviews(
  db: Database.Database,
  prId: number,
  reviews: ReviewRecord[],
): void {
  db.prepare("DELETE FROM pr_reviews WHERE pr_id = ?").run(prId);

  const insertReview = db.prepare(
    `
      INSERT INTO pr_reviews (pr_id, author_login, state, body, submitted_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  );

  for (const review of reviews) {
    insertReview.run(
      prId,
      normalizeLogin(review.authorLogin),
      review.state,
      review.body,
      review.submittedAt,
    );
  }
}

export function upsertPrComments(
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

export function upsertReviewRequests(
  db: Database.Database,
  prId: number,
  requests: ReviewRequestRecord[],
): void {
  db.prepare("DELETE FROM review_requests WHERE pr_id = ?").run(prId);

  const insertRequest = db.prepare(
    `
      INSERT INTO review_requests (pr_id, requested_login, requested_at)
      VALUES (?, ?, ?)
    `,
  );

  for (const request of requests) {
    insertRequest.run(
      prId,
      normalizeLogin(request.login),
      request.requestedAt ?? null,
    );
  }
}

export function upsertDiscoveredPr(
  db: Database.Database,
  pr: DiscoveredPr,
): number {
  const transaction = db.transaction(() => {
    const prId = upsertPr(db, pr);
    upsertPrFiles(db, prId, pr.changedFiles, pr.unsafeFiles);
    upsertPrChecks(db, prId, pr.checks);
    upsertPrReviews(db, prId, pr.reviews);
    upsertPrComments(db, prId, pr.comments);
    upsertReviewRequests(db, prId, pr.reviewRequests);
    return prId;
  });

  return transaction();
}

function splitGithubRepo(github: string): { owner: string; name: string } {
  const [owner, name, ...rest] = github.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`Invalid GitHub repository slug "${github}"`);
  }

  return { owner, name };
}
