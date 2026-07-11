import type { Database } from '../store/db.js';
import type { PolicyDecision } from '../policy/evaluate.js';

export { AllTrackedItem } from '../policy/evaluate.js';
import type { AllTrackedItem } from '../policy/evaluate.js';

export interface FocusQueue {
  now: AllTrackedItem[];
  next: AllTrackedItem[];
  monitor: AllTrackedItem[];
}

interface PrRow {
  repository_key: string;
  pr_number: number;
  head_sha: string;
  base_sha: string;
  title: string;
  author: string;
  draft: number;
  labels_json: string;
  additions: number;
  deletions: number;
  changed_files_json: string;
  review_requested: number;
  check_summary_json: string;
  updated_at: string | null;
  explicit_request_timestamp: string | null;
  body_truncated: string;
  source_mode: 'registered-source' | 'remote-evidence-only';
}

interface AttentionRow {
  repository_key: string;
  pr_number: number;
  policy_hash: string;
  policy_json: string;
  state: string;
}

function projectTrackedItem(pr: PrRow, attention: AttentionRow): AllTrackedItem {
  const policy: PolicyDecision = JSON.parse(attention.policy_json);
  return {
    repositoryKey: pr.repository_key,
    prNumber: pr.pr_number,
    headSha: pr.head_sha,
    baseSha: pr.base_sha,
    title: pr.title,
    author: pr.author,
    draft: pr.draft === 1,
    labels: JSON.parse(pr.labels_json),
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: JSON.parse(pr.changed_files_json),
    reviewRequested: pr.review_requested === 1,
    checkSummary: JSON.parse(pr.check_summary_json),
    updatedAt: pr.updated_at,
    explicitRequestTimestamp: pr.explicit_request_timestamp,
    policy,
    sourceMode: pr.source_mode,
    bodyTruncated: pr.body_truncated,
  };
}

export class WorkGraph {
  constructor(private readonly db: Database) {}

  getAllTracked(): AllTrackedItem[] {
    const prs = this.db.all<PrRow>(
      `SELECT * FROM prs ORDER BY repository_key, pr_number`,
    );
    const attentionRows = this.db.all<AttentionRow>(
      `SELECT * FROM attention_items ORDER BY repository_key, pr_number`,
    );

    const attentionByKey = new Map<string, AttentionRow>();
    for (const row of attentionRows) {
      attentionByKey.set(`${row.repository_key}:${row.pr_number}`, row);
    }

    const items: AllTrackedItem[] = [];
    for (const pr of prs) {
      const attention = attentionByKey.get(`${pr.repository_key}:${pr.pr_number}`);
      if (!attention) continue;
      items.push(projectTrackedItem(pr, attention));
    }

    return items;
  }

  getFocusQueue(): FocusQueue {
    const all = this.getAllTracked();
    const ranked = all.filter(item => item.policy.prioritySortOrdinal < 4);

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
