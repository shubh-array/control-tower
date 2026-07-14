import type Database from 'better-sqlite3';
import type { PolicyDecision, ReviewQueueItem } from '../policy/evaluate.js';

export type { ReviewQueueItem } from '../policy/evaluate.js';

export interface FocusQueue {
  now: ReviewQueueItem[];
  next: ReviewQueueItem[];
  monitor: ReviewQueueItem[];
}

interface PrRow {
  repository_key: string;
  pr_number: number;
  head_sha: string;
  title: string;
  url: string;
  author_login: string;
  github_updated: string;
  explicit_request: number;
  explicit_request_at: string | null;
  policy_json: string;
}

function projectReviewItem(row: PrRow): ReviewQueueItem {
  const policy: PolicyDecision = JSON.parse(row.policy_json);
  return {
    repositoryKey: row.repository_key,
    prNumber: row.pr_number,
    headSha: row.head_sha,
    title: row.title,
    url: row.url,
    author: row.author_login,
    updatedAt: row.github_updated,
    explicitRequest: row.explicit_request === 1,
    explicitRequestTimestamp: row.explicit_request_at,
    policy,
  };
}

export class WorkGraph {
  constructor(private readonly db: Database.Database) {}

  getFocusQueue(): FocusQueue {
    const rows = this.db
      .prepare(
        `
          SELECT
            p.repository_id AS repository_key,
            p.pr_number,
            p.head_sha,
            p.title,
            p.url,
            p.author_login,
            p.github_updated,
            p.explicit_request,
            p.explicit_request_at,
            p.policy_json
          FROM prs p
          ORDER BY p.repository_id, p.pr_number
        `,
      )
      .all() as PrRow[];

    const ranked = rows
      .map(projectReviewItem)
      .filter((item) => item.policy.prioritySortOrdinal < 4);

    const now: ReviewQueueItem[] = [];
    const next: ReviewQueueItem[] = [];
    const monitor: ReviewQueueItem[] = [];

    for (const item of ranked) {
      const ord = item.policy.prioritySortOrdinal;
      if (ord <= 1) {
        now.push(item);
      } else if (ord === 2) {
        next.push(item);
      } else {
        monitor.push(item);
      }
    }

    return { now, next, monitor };
  }
}
