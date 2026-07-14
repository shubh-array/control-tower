import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { upsertRepository, upsertEligiblePr } from "../../src/normalize/upsert.js";
import {
  enqueueFromPolicyDecision,
  type EnqueueDeps,
  type EnqueueInput,
} from "../../src/orchestrator/enqueue.js";
import {
  computeJobIdentity,
  computePolicyDecisionHash,
} from "../../src/orchestrator/job-identity.js";
import type { PolicyDecision } from "../../src/policy/evaluate.js";
import type { DiscoveredPr } from "../../src/github/types.js";
import { PrNotEligibleForReviewError } from "../../src/orchestrator/analyze-errors.js";

const MATCHER_VERSION = 1;

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: "p1",
    prioritySortOrdinal: 1,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: "auto",
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function buildSqliteEnqueueDeps(db: Database.Database): EnqueueDeps {
  return {
    findActiveJobByIdentity(identityHash: string) {
      return (
        (db
          .prepare(
            `SELECT id, head_sha, policy_hash, source_mode, state, version
             FROM jobs WHERE identity_hash = ? AND state NOT IN ('superseded', 'cancelled', 'published')`,
          )
          .get(identityHash) as {
          id: string;
          head_sha: string;
          policy_hash: string;
          source_mode: string;
          state: string;
          version: number;
        } | undefined) ?? null
      );
    },
    findActiveJobsByPr(repositoryKey: string, prNumber: number) {
      return db
        .prepare(
          `SELECT id, head_sha, policy_hash, source_mode, state, version
           FROM jobs
           WHERE repository_key = ? AND pr_number = ?
             AND state NOT IN ('superseded', 'cancelled', 'published', 'failed')`,
        )
        .all(repositoryKey, prNumber) as Array<{
          id: string;
          head_sha: string;
          policy_hash: string;
          source_mode: string;
          state: string;
          version: number;
        }>;
    },
    insertJob(row: Record<string, unknown>): string {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO jobs (
          id, identity_hash, repository_id, repository_key, pr_number,
          head_sha, source_mode, policy_hash, state, version,
          priority_sort_ordinal, explicit_request_sort, queue_timestamp, queued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      ).run(
        id,
        row.identityHash,
        row.repositoryId ?? null,
        row.repositoryKey,
        row.prNumber,
        row.headSha,
        row.sourceMode,
        row.policyHash,
        row.prioritySortOrdinal ?? 3,
        row.explicitRequest ? 0 : 1,
        row.explicitRequest ? new Date().toISOString() : null,
      );
      return id;
    },
    supersede(jobId: string, version: number): void {
      db.prepare(
        `UPDATE jobs SET state = 'superseded', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND version = ?`,
      ).run(jobId, version);
    },
    computeIdentityHash(input: Record<string, unknown>) {
      return computeJobIdentity({
        role: "primaryReview",
        repositoryKey: input.repositoryKey as string,
        prNumber: input.prNumber as number,
        headSha: input.headSha as string,
        sourceMode: input.sourceMode as "registered-source" | "remote-evidence-only",
        policyDecisionHash: input.policyDecisionHash as string,
      });
    },
    computePolicyHash(decision: PolicyDecision) {
      return computePolicyDecisionHash({
        matcherVersion: MATCHER_VERSION,
        decision,
        reviewRelevantPolicySubset: {},
      });
    },
  };
}

function resolveSourceMode(
  local: { repositoryPaths: Record<string, string> },
  repositoryId: string,
): "registered-source" | "remote-evidence-only" {
  const path = local.repositoryPaths[repositoryId];
  return path && existsSync(path) ? "registered-source" : "remote-evidence-only";
}

function manualEnqueueAnalysis(
  db: Database.Database,
  enqueueDeps: EnqueueDeps,
  local: { repositoryPaths: Record<string, string> },
  input: { repositoryKey: string; prNumber: number },
): string {
  const prRow = db
    .prepare(
      `SELECT head_sha, repository_id, policy_json, explicit_request
       FROM prs WHERE repository_id = ? AND pr_number = ?`,
    )
    .get(input.repositoryKey, input.prNumber) as
    | {
        head_sha: string;
        repository_id: string;
        policy_json: string;
        explicit_request: number;
      }
    | undefined;

  if (!prRow) {
    throw new PrNotEligibleForReviewError();
  }

  const policy = JSON.parse(prRow.policy_json) as PolicyDecision;
  if (!policy.eligible) {
    throw new PrNotEligibleForReviewError();
  }

  const sourceMode = resolveSourceMode(local, prRow.repository_id);
  const result = enqueueFromPolicyDecision(enqueueDeps, {
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: prRow.head_sha,
    sourceMode,
    policy,
    normalizedRepositoryIdentity: input.repositoryKey,
    explicitRequest: prRow.explicit_request === 1,
    manualRequest: true,
  });

  if (!result.jobId) {
    throw new PrNotEligibleForReviewError();
  }

  return result.jobId;
}

function seedEligiblePr(db: Database.Database, policy: PolicyDecision): void {
  upsertRepository(db, {
    id: "pba-webapp",
    github: "Org/pba-webapp",
    host: "github.com",
    defaultBranch: "main",
    resourceClass: "medium",
  });

  const pr: DiscoveredPr = {
    repositoryId: "pba-webapp",
    githubOwnerRepo: "Org/pba-webapp",
    prNumber: 42,
    title: "Test PR",
    body: "",
    url: "https://github.com/Org/pba-webapp/pull/42",
    state: "OPEN",
    isDraft: false,
    authorLogin: "dev",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    labels: [],
    additions: 1,
    deletions: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    changedFiles: ["src/a.ts"],
    unsafeFiles: [],
    reviewRequests: [],
    checks: [],
    reviews: [],
    comments: [],
    explicitRequest: false,
  };

  upsertEligiblePr(db, pr, policy);
}

function makeInput(
  policy: PolicyDecision,
  overrides: Partial<EnqueueInput> = {},
): EnqueueInput {
  return {
    repositoryKey: "pba-webapp",
    prNumber: 42,
    headSha: "a".repeat(40),
    sourceMode: "registered-source",
    policy,
    normalizedRepositoryIdentity: "pba-webapp",
    explicitRequest: false,
    manualRequest: false,
    ...overrides,
  };
}

describe("enqueueFromPolicyDecision (sqlite)", () => {
  let db: Database.Database;
  let enqueueDeps: EnqueueDeps;

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);
    enqueueDeps = buildSqliteEnqueueDeps(db);
    seedEligiblePr(db, stubPolicy({ analysisMode: "auto", priorityStatus: "p1" }));
  });

  afterEach(() => {
    db.close();
  });

  it("creates a replacement job when policy changes for same PR/head/source", () => {
    const first = enqueueFromPolicyDecision(
      enqueueDeps,
      makeInput(stubPolicy({ analysisMode: "auto", priorityStatus: "p1" })),
    );
    expect(first.enqueued).toBe(true);

    const second = enqueueFromPolicyDecision(
      enqueueDeps,
      makeInput(stubPolicy({ analysisMode: "auto", priorityStatus: "p2", prioritySortOrdinal: 2 })),
    );

    expect(second.enqueued).toBe(true);
    expect(second.jobId).not.toBe(first.jobId);

    const jobs = db
      .prepare(`SELECT id, state, identity_hash FROM jobs ORDER BY queued_at`)
      .all() as Array<{ id: string; state: string; identity_hash: string }>;

    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.state).toBe("superseded");
    expect(jobs[1]!.state).toBe("queued");
    expect(jobs[0]!.identity_hash).not.toBe(jobs[1]!.identity_hash);
  });

  it("reuses failed job on identical auto enqueue without duplicate insert", () => {
    const input = makeInput(stubPolicy({ analysisMode: "auto", priorityStatus: "p1" }));
    const first = enqueueFromPolicyDecision(enqueueDeps, input);
    expect(first.enqueued).toBe(true);
    expect(first.jobId).toBeDefined();

    db.prepare(`UPDATE jobs SET state = 'failed' WHERE id = ?`).run(first.jobId);

    const second = enqueueFromPolicyDecision(enqueueDeps, input);

    expect(second.enqueued).toBe(false);
    expect(second.reason).toBe("existing_job_current");
    expect(second.jobId).toBe(first.jobId);

    const jobCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM jobs`).get() as { cnt: number }
    ).cnt;
    expect(jobCount).toBe(1);
  });
});

describe("manual analyze enqueue (sqlite)", () => {
  let db: Database.Database;
  let enqueueDeps: EnqueueDeps;
  let local: { repositoryPaths: Record<string, string> };

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);
    enqueueDeps = buildSqliteEnqueueDeps(db);
    seedEligiblePr(db, stubPolicy({ analysisMode: "on_demand", authorOnly: true }));
    const repoPath = mkdtempSync(join(tmpdir(), "ct-analyze-repo-"));
    local = { repositoryPaths: { "pba-webapp": repoPath } };
  });

  afterEach(() => {
    db.close();
  });

  it("returns the same job id for repeated manual analyze of a current eligible job", () => {
    const first = manualEnqueueAnalysis(db, enqueueDeps, local, {
      repositoryKey: "pba-webapp",
      prNumber: 42,
    });
    const second = manualEnqueueAnalysis(db, enqueueDeps, local, {
      repositoryKey: "pba-webapp",
      prNumber: 42,
    });

    expect(second).toBe(first);

    const activeCount = (
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM jobs WHERE state NOT IN ('superseded', 'cancelled', 'published', 'failed')`,
        )
        .get() as { cnt: number }
    ).cnt;
    expect(activeCount).toBe(1);
  });

  it("derives source mode from local config regardless of caller intent", () => {
    const jobId = manualEnqueueAnalysis(db, enqueueDeps, local, {
      repositoryKey: "pba-webapp",
      prNumber: 42,
    });

    const row = db
      .prepare(`SELECT source_mode FROM jobs WHERE id = ?`)
      .get(jobId) as { source_mode: string };
    expect(row.source_mode).toBe("registered-source");
  });
});
