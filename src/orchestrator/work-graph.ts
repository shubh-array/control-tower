import type Database from 'better-sqlite3';
import type { PolicyDecision, CheckSummaryEntry } from '../policy/evaluate.js';

export type { AllTrackedItem } from '../policy/evaluate.js';
import type { AllTrackedItem } from '../policy/evaluate.js';

export interface FocusQueue {
  now: AllTrackedItem[];
  next: AllTrackedItem[];
  monitor: AllTrackedItem[];
}

const BODY_TRUNCATE_BYTES = 8 * 1024;

interface JoinedRow {
  repository_key: string;
  pr_number: number;
  pr_id: number;
  head_sha: string;
  base_sha: string;
  title: string;
  author_login: string;
  draft: number;
  labels_json: string;
  additions: number;
  deletions: number;
  github_updated: string;
  explicit_request_at: string | null;
  body: string | null;
  policy_json: string;
  source_mode: 'registered-source' | 'remote-evidence-only';
  review_requested: number;
}

function truncateBody(body: string | null): string {
  if (!body) return '';
  const bytes = Buffer.from(body, 'utf-8');
  if (bytes.length <= BODY_TRUNCATE_BYTES) return body;
  return bytes.subarray(0, BODY_TRUNCATE_BYTES).toString('utf-8');
}

function loadChangedFiles(
  db: Database.Database,
  prId: number,
): string[] {
  const rows = db
    .prepare(
      `SELECT path FROM pr_files WHERE pr_id = ? AND is_unsafe = 0 ORDER BY path`,
    )
    .all(prId) as Array<{ path: string }>;
  return rows.map((r) => r.path);
}

function loadCheckSummary(
  db: Database.Database,
  prId: number,
): CheckSummaryEntry[] {
  const rows = db
    .prepare(
      `SELECT name, status, conclusion FROM pr_checks WHERE pr_id = ? ORDER BY name`,
    )
    .all(prId) as Array<{ name: string; status: string; conclusion: string | null }>;
  return rows.map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
  }));
}

function projectTrackedItem(
  row: JoinedRow,
  changedFiles: string[],
  checkSummary: CheckSummaryEntry[],
): AllTrackedItem {
  const policy: PolicyDecision = JSON.parse(row.policy_json);
  return {
    repositoryKey: row.repository_key,
    prNumber: row.pr_number,
    headSha: row.head_sha,
    baseSha: row.base_sha,
    title: row.title,
    author: row.author_login,
    draft: row.draft === 1,
    labels: JSON.parse(row.labels_json),
    additions: row.additions,
    deletions: row.deletions,
    changedFiles,
    reviewRequested: row.review_requested === 1,
    checkSummary,
    updatedAt: row.github_updated,
    explicitRequestTimestamp: row.explicit_request_at,
    policy,
    sourceMode: row.source_mode,
    bodyTruncated: truncateBody(row.body),
  };
}

export class WorkGraph {
  constructor(private readonly db: Database.Database) {}

  getAllTracked(): AllTrackedItem[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            ai.repository_key,
            ai.pr_number,
            ai.policy_json,
            ai.source_mode,
            p.id AS pr_id,
            p.head_sha,
            p.base_sha,
            p.title,
            p.author_login,
            p.draft,
            p.labels_json,
            p.additions,
            p.deletions,
            p.github_updated,
            p.explicit_request_at,
            p.body,
            EXISTS(
              SELECT 1 FROM review_requests rr WHERE rr.pr_id = p.id
            ) AS review_requested
          FROM attention_items ai
          JOIN prs p
            ON p.repository_id = ai.repository_id
           AND p.pr_number = ai.pr_number
          ORDER BY ai.repository_key, ai.pr_number
        `,
      )
      .all() as JoinedRow[];

    return rows.map((row) =>
      projectTrackedItem(
        row,
        loadChangedFiles(this.db, row.pr_id),
        loadCheckSummary(this.db, row.pr_id),
      ),
    );
  }

  getFocusQueue(): FocusQueue {
    const all = this.getAllTracked();
    const ranked = all.filter((item) => item.policy.prioritySortOrdinal < 4);

    const now: AllTrackedItem[] = [];
    const next: AllTrackedItem[] = [];
    const monitor: AllTrackedItem[] = [];

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
