import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import {
  buildPipelineDeps,
  type PipelineRunnerContext,
} from "../../src/orchestrator/pipeline-runner.js";
import { executePipeline, type PipelineJob } from "../../src/orchestrator/pipeline.js";
import * as contextBuild from "../../src/orchestrator/context-build.js";
import * as sourcePipeline from "../../src/orchestrator/source-pipeline.js";
import type { AdapterRunInput, AdapterRunResult } from "../../src/cursor/adapter.js";
import { SourceFetchError } from "../../src/source/errors.js";
import { createCommitRecord } from "../../src/context/provenance.js";
import { forceRemoveDir } from "../helpers/force-remove-dir.js";

const appRoot = resolve(join(import.meta.dirname, "../.."));

function insertQueuedJob(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    sourceMode: "registered-source" | "remote-evidence-only";
  }> = {},
): PipelineJob {
  const id = overrides.id ?? "job-prod-deps-1";
  const sourceMode = overrides.sourceMode ?? "remote-evidence-only";
  db.prepare(
    `INSERT INTO jobs (
      id, identity_hash, repository_key, pr_number, head_sha, source_mode,
      policy_hash, state, version, queued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?)`,
  ).run(
    id,
    "identity-prod-deps",
    "pba-webapp",
    42,
    "a".repeat(40),
    sourceMode,
    "policy-hash-prod",
    new Date().toISOString(),
  );

  return {
    id,
    repositoryKey: "pba-webapp",
    prNumber: 42,
    headSha: "a".repeat(40),
    sourceMode,
    policyHash: "policy-hash-prod",
    identityHash: "identity-prod-deps",
    version: 1,
  };
}

function makeValidAgentOutput(
  coverage: Record<string, unknown>,
  provenanceId: string,
) {
  return JSON.stringify({
    schemaVersion: 1,
    coverage,
    summary: { intent: "test", implementation: "test" },
    observations: [
      {
        type: "observation",
        statement: "Looks fine",
        provenanceRefs: [provenanceId],
        fileReferences: [],
      },
    ],
    checks: [],
    findings: [],
    unknowns: [],
    recommendedDisposition: "needs_human",
    draftSummary: {
      body: "No publishable draft",
      observationIndexes: [0],
      provenanceRefs: [provenanceId],
    },
  });
}

describe("Integration: production pipeline deps wiring", () => {
  let db: Database.Database;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "ct-prod-deps-"));
    db = openDatabase(join(dataDir, "test.sqlite"));
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    forceRemoveDir(dataDir);
  });

  it("uses content-hashed run-input identity and real context preparation", async () => {
    const job = insertQueuedJob(db);
    const computeSpy = vi.spyOn(contextBuild, "computeRunContext");
    const materializeSpy = vi.spyOn(contextBuild, "materializeRunContext");
    const provenanceId = createCommitRecord({
      repositoryId: job.repositoryKey,
      commitSha: job.headSha,
    }).id;
    const remoteCoverage = {
      mode: "remote-evidence-only",
      sourceTreeInspected: false,
      diffFiltered: true,
      omittedProtectedPaths: [],
      omittedSourceEntries: [],
      missingCoverage: ["source_tree"],
    };

    const ctx: PipelineRunnerContext = {
      dataDirectory: dataDir,
      appRoot,
      modelSpecHash: "model-spec-test",
      runAgent: () => ({
        rawOutput: makeValidAgentOutput(remoteCoverage, provenanceId),
        exitCode: 0,
        modelId: "test-model",
      }),
    };

    const deps = buildPipelineDeps(db, ctx, job.id);
    const result = await executePipeline(deps, job);

    expect(result.success).toBe(true);
    expect(computeSpy).toHaveBeenCalled();
    expect(materializeSpy).toHaveBeenCalled();

    const run = db
      .prepare(`SELECT run_input_hash FROM runs WHERE job_id = ?`)
      .get(job.id) as { run_input_hash: string };
    expect(run.run_input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.run_input_hash).not.toMatch(/^pipeline-/);

    computeSpy.mockRestore();
    materializeSpy.mockRestore();
  });

  it("registered-source prepareSource throws SourceFetchError instead of unconditional materialize_failed", async () => {
    const job = insertQueuedJob(db, { sourceMode: "registered-source" });
    const sourceSpy = vi.spyOn(sourcePipeline, "prepareRegisteredSource");

    const ctx: PipelineRunnerContext = {
      dataDirectory: dataDir,
      appRoot,
      modelSpecHash: "model-spec-test",
      repositoryPaths: {},
      protectedPaths: ["**/.env"],
    };

    const deps = buildPipelineDeps(db, ctx, job.id);
    const result = await executePipeline(deps, job);

    expect(sourceSpy).toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe("fetch_failed");

    await expect(
      sourcePipeline.prepareRegisteredSource({
        dataDirectory: dataDir,
        jobId: job.id,
        repositoryKey: job.repositoryKey,
        prNumber: job.prNumber,
        headSha: job.headSha,
        repositoryPath: undefined,
        homePath: tmpdir(),
        protectedPaths: [],
      }),
    ).rejects.toBeInstanceOf(SourceFetchError);

    sourceSpy.mockRestore();
  });

  it("invokes injectable cursor adapter without live Cursor binary", async () => {
    const job = insertQueuedJob(db);
    const provenanceId = createCommitRecord({
      repositoryId: job.repositoryKey,
      commitSha: job.headSha,
    }).id;
    const remoteCoverage = {
      mode: "remote-evidence-only",
      sourceTreeInspected: false,
      diffFiltered: true,
      omittedProtectedPaths: [],
      omittedSourceEntries: [],
      missingCoverage: ["source_tree"],
    };
    const adapter = vi.fn(
      async (_input: AdapterRunInput): Promise<AdapterRunResult> => ({
        success: true,
        resultText: makeValidAgentOutput(remoteCoverage, provenanceId),
        exitCode: 0,
        actualModel: "injected-model",
        events: [],
        usage: { inputTokens: 12, outputTokens: 34 },
      }),
    );

    const ctx: PipelineRunnerContext = {
      dataDirectory: dataDir,
      appRoot,
      modelSpecHash: "model-spec-test",
      cursorAdapter: adapter,
    };

    const deps = buildPipelineDeps(db, ctx, job.id);
    const result = await executePipeline(deps, job);

    expect(result.success).toBe(true);
    expect(adapter).toHaveBeenCalledTimes(1);
    const adapterInput = adapter.mock.calls[0]![0]!;
    expect(adapterInput.role).toBe("primaryReview");
    expect(adapterInput.binary).toBe("agent");
  });
});
