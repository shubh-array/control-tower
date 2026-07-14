import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { computeRunDirectoryLayout } from "../../src/context/prepare.js";
import { loadDraftBundle } from "../../src/orchestrator/draft-loader.js";
import { computeOperationHash } from "../../src/publisher/operation-hash.js";
import { registerDraftOperations } from "../../src/publisher/register-draft.js";
import { GuardInputStore } from "../../src/publisher/guard-store.js";
import { PublisherService } from "../../src/publisher/publisher-service.js";

const coverage = {
  mode: "registered-source" as const,
  sourceTreeInspected: true,
  diffFiltered: true,
  omittedProtectedPaths: [],
  omittedSourceEntries: [],
  missingCoverage: [],
};

const reviewOutput = {
  schemaVersion: 1,
  coverage,
  summary: { intent: "Fix bug", implementation: "Updated handler" },
  observations: [
    {
      type: "observation",
      statement: "Unused import",
      provenanceRefs: ["pv_c"],
      fileReferences: [],
    },
  ],
  checks: [],
  findings: [
    {
      severity: "low",
      confidence: "high",
      title: "Unused import",
      rationale: "Import is unused",
      file: "src/a.ts",
      location: { side: "RIGHT", line: 5, startSide: null, startLine: null },
      observationIndexes: [0],
      draftComment: "Remove unused import",
    },
  ],
  unknowns: [],
  recommendedDisposition: "comment",
  draftSummary: {
    body: "LGTM with minor suggestions",
    observationIndexes: [],
    provenanceRefs: ["pv_a", "pv_b"],
  },
};

describe("loadDraftBundle", () => {
  let tmp: string;
  let dataDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ct-draft-loader-"));
    dataDir = join(tmp, "data");
    db = openDatabase(join(tmp, "test.sqlite"));
    runMigrations(db);

    db.prepare(
      `INSERT INTO repositories (id, github_identity, github_owner, github_repo, default_branch, resource_class)
       VALUES ('pba-webapp', 'github.com/org/pba-webapp', 'org', 'pba-webapp', 'main', 'medium')`,
    ).run();

    db.prepare(
      `INSERT INTO jobs (id, identity_hash, repository_key, pr_number, head_sha, source_mode, policy_hash, state, version, accepted_run_id)
       VALUES ('job-1', 'hash-1', 'pba-webapp', 42, ?, 'registered-source', 'ph', 'draft_ready', 1, 'run-1')`,
    ).run("a".repeat(40));

    db.prepare(
      `INSERT INTO prs (repository_id, pr_number, head_sha, base_sha, title, author_login, state, github_updated, fetched_at)
       VALUES ('pba-webapp', 42, ?, ?, 'Test PR', 'author', 'open', ?, ?)`,
    ).run("a".repeat(40), "b".repeat(40), new Date().toISOString(), new Date().toISOString());

    db.prepare(
      `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version)
       VALUES ('run-1', 'job-1', 1, 'input-1', 'succeeded', 1)`,
    ).run();

    const layout = computeRunDirectoryLayout(dataDir, "job-1", "run-1");
    mkdirSync(layout.runDir, { recursive: true });
    writeFileSync(layout.outputPath, JSON.stringify(reviewOutput));
    writeFileSync(layout.validatedProvenancePath, "[]");
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("response operationHashes match registered guard/publisher keys from one bundle", () => {
    const bundle = loadDraftBundle(db, "job-1", {
      dataDirectory: dataDir,
      principalLogin: "shubh-array",
    });
    expect(bundle).not.toBeNull();
    expect(bundle!.detail.operationPlan).not.toBeNull();

    const responseHashes = bundle!.detail.operationPlan!.operations.map(
      (o) => o.operationHash,
    );
    const registeredHashes = bundle!.operations.map((op) =>
      computeOperationHash(op),
    );
    expect(responseHashes).toEqual(registeredHashes);

    const guardStore = new GuardInputStore();
    const publisher = new PublisherService({
      ghAdapter: async () => ({ ok: true }),
      authenticatedLogin: "shubh-array",
      configuredOperator: "shubh-array",
    });

    registerDraftOperations(guardStore, publisher, bundle!.operations, {
      publicationMode: "shadow",
      authenticatedLogin: "shubh-array",
      configuredOperator: "shubh-array",
      currentHeadSha: bundle!.headSha,
      reviewedHeadSha: bundle!.headSha,
      acceptedRunId: bundle!.acceptedRunId,
      approvedRunInputHash: bundle!.runInputHash,
    });

    for (const hash of responseHashes) {
      expect(guardStore.getContext(hash)).not.toBeNull();
    }
  });

  it('marks draft stale when job head_sha differs from prs.head_sha', () => {
    db.prepare(
      `UPDATE prs SET head_sha = ? WHERE repository_id = ? AND pr_number = ?`,
    ).run("c".repeat(40), "pba-webapp", 42);

    const bundle = loadDraftBundle(db, "job-1", {
      dataDirectory: dataDir,
      principalLogin: "shubh-array",
    });

    expect(bundle).not.toBeNull();
    expect(bundle!.detail.stale).toBe(true);
    expect(bundle!.detail.reviewedHeadSha).toBe("a".repeat(40));
    expect(bundle!.detail.currentHeadSha).toBe("c".repeat(40));
  });
});
