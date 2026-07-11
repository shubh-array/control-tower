import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  executePipeline,
  type PipelineDeps,
  type PipelineJob,
} from "./pipeline.js";
import { transitionJob, transitionRun } from "./transitions.js";
import type { JobState } from "./job-state.js";
import type { RunState } from "./run-state.js";
import { computeRunDirectoryLayout } from "../context/prepare.js";
import type { CoverageObject } from "../context/coverage.js";
import { validateReviewOutput } from "../cursor/validate-review.js";
import { sealRun as sealRunDir } from "../context/seal.js";

export interface PipelineRunnerContext {
  dataDirectory: string;
}

export function loadPipelineJob(
  db: Database.Database,
  jobId: string,
): PipelineJob | null {
  const row = db
    .prepare(
      `SELECT id, repository_key, pr_number, head_sha, source_mode,
              policy_hash, identity_hash, version, state
       FROM jobs WHERE id = ?`,
    )
    .get(jobId) as
    | {
        id: string;
        repository_key: string;
        pr_number: number;
        head_sha: string;
        source_mode: "registered-source" | "remote-evidence-only";
        policy_hash: string;
        identity_hash: string;
        version: number;
        state: JobState;
      }
    | undefined;

  if (!row || row.state !== "queued") return null;

  return {
    id: row.id,
    repositoryKey: row.repository_key,
    prNumber: row.pr_number,
    headSha: row.head_sha,
    sourceMode: row.source_mode,
    policyHash: row.policy_hash,
    identityHash: row.identity_hash,
    version: row.version,
  };
}

export function buildPipelineDeps(
  db: Database.Database,
  ctx: PipelineRunnerContext,
): PipelineDeps {
  const transitions: PipelineDeps["transitions"] = [];
  const runTransitions: PipelineDeps["runTransitions"] = [];

  return {
    transitions,
    runTransitions,
    transitionJob(jobId, from, to) {
      const row = db
        .prepare(`SELECT state, version FROM jobs WHERE id = ?`)
        .get(jobId) as { state: JobState; version: number } | undefined;
      if (!row) throw new Error(`job not found: ${jobId}`);
      const result = transitionJob(db, {
        jobId,
        expectedState: from as JobState,
        expectedVersion: row.version,
        newState: to as JobState,
      });
      transitions.push({ jobId, from, to });
      return { success: result.success, newVersion: result.newVersion };
    },
    transitionRun(runId, from, to) {
      const row = db
        .prepare(`SELECT state, version FROM runs WHERE id = ?`)
        .get(runId) as { state: RunState; version: number } | undefined;
      if (!row) throw new Error(`run not found: ${runId}`);
      const result = transitionRun(db, {
        runId,
        expectedState: from as RunState,
        expectedVersion: row.version,
        newState: to as RunState,
      });
      runTransitions.push({ runId, from, to });
      return { success: result.success, newVersion: result.newVersion };
    },
    allocateRun(jobId) {
      const maxAttempt =
        (
          db
            .prepare(
              `SELECT MAX(attempt_number) as n FROM runs WHERE job_id = ?`,
            )
            .get(jobId) as { n: number | null }
        ).n ?? 0;
      const runId = randomUUID();
      const runInputHash = `pipeline-${jobId}-${maxAttempt + 1}`;
      db.prepare(
        `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version, started_at)
         VALUES (?, ?, ?, ?, 'allocated', 1, ?)`,
      ).run(
        runId,
        jobId,
        maxAttempt + 1,
        runInputHash,
        new Date().toISOString(),
      );
      db.prepare(
        `UPDATE jobs SET latest_run_id = ?, updated_at = ? WHERE id = ?`,
      ).run(runId, new Date().toISOString(), jobId);
      return { runId, version: 1 };
    },
    prepareContext(jobId, runId) {
      const layout = computeRunDirectoryLayout(ctx.dataDirectory, jobId, runId);
      const coverage = {
        mode: "remote-evidence-only" as const,
        sourceTreeInspected: false,
        diffFiltered: true,
        omittedProtectedPaths: [] as Array<{ path: string; reason: string }>,
        omittedSourceEntries: [] as Array<{ path: string; reason: string }>,
        missingCoverage: ["source_tree"],
      };
      return {
        runDir: layout.runDir,
        manifest: { layers: 9 },
        coverage,
      };
    },
    prepareSource() {
      throw new Error("materialize_failed");
    },
    runAgent(_runId, _runDir) {
      const coverage = {
        mode: "remote-evidence-only" as const,
        sourceTreeInspected: false,
        diffFiltered: true,
        omittedProtectedPaths: [] as Array<{ path: string; reason: string }>,
        omittedSourceEntries: [] as Array<{ path: string; reason: string }>,
        missingCoverage: ["source_tree"],
      };
      return {
        rawOutput: JSON.stringify({
          schemaVersion: 1,
          coverage,
          summary: { intent: "pending", implementation: "pending" },
          observations: [
            {
              type: "observation",
              statement: "Automated stub pending full agent wiring.",
              provenanceRefs: [],
              fileReferences: [],
            },
          ],
          checks: [],
          findings: [],
          unknowns: ["full_agent_wiring"],
          recommendedDisposition: "needs_human",
          draftSummary: {
            body: "Pipeline agent not fully wired — needs human review.",
            observationIndexes: [0],
            provenanceRefs: [],
          },
        }),
        exitCode: 0,
        modelId: "stub",
      };
    },
    validateOutput(rawOutput, coverage) {
      try {
        const parsed = JSON.parse(rawOutput);
        const result = validateReviewOutput(parsed, {
          coverage: coverage as unknown as CoverageObject,
          catalog: new Map(),
          sourceManifest: new Map(),
          sourceMode: "remote-evidence-only",
        });
        return {
          valid: result.valid,
          errors: result.errors,
          validatedProvenance: result.validatedProvenance,
        };
      } catch (err) {
        return {
          valid: false,
          errors: [err instanceof Error ? err.message : String(err)],
          validatedProvenance: [],
        };
      }
    },
    async sealRun(runId, runDir) {
      if (!runDir) return { sealed: false };
      const jobRow = db
        .prepare(`SELECT job_id FROM runs WHERE id = ?`)
        .get(runId) as { job_id: string } | undefined;
      try {
        await sealRunDir(runDir, {
          runId,
          jobId: jobRow?.job_id ?? "",
          outcome: "succeeded",
          sealedAt: new Date().toISOString(),
        });
        return { sealed: true };
      } catch {
        return { sealed: false };
      }
    },
    updatePointers(jobId, runId) {
      db.prepare(
        `UPDATE jobs SET latest_run_id = ?, accepted_run_id = ?, updated_at = ? WHERE id = ?`,
      ).run(runId, runId, new Date().toISOString(), jobId);
      return { latestRunId: runId, acceptedRunId: runId };
    },
    cleanupSource() {},
    getJobState(jobId) {
      const row = db
        .prepare(`SELECT state, version FROM jobs WHERE id = ?`)
        .get(jobId) as { state: string; version: number };
      return row;
    },
    getRunState(runId) {
      const row = db
        .prepare(`SELECT state, version FROM runs WHERE id = ?`)
        .get(runId) as { state: string; version: number };
      return row;
    },
  };
}

export async function runPipelineForJob(
  db: Database.Database,
  ctx: PipelineRunnerContext,
  jobId: string,
): Promise<void> {
  const job = loadPipelineJob(db, jobId);
  if (!job) return;
  const deps = buildPipelineDeps(db, ctx);
  await executePipeline(deps, job);
}
