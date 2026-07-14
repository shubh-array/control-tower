import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
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
import type { CoverageObject, DiffFilterOutcome } from "../context/coverage.js";
import type { HarnessManifest } from "../context/harness-manifest.js";
import { validateReviewOutput } from "../cursor/validate-review.js";
import {
  runCursorAgent,
  type AdapterRunInput,
  type AdapterRunResult,
} from "../cursor/adapter.js";
import { extractJsonFromResult } from "../cursor/ndjson.js";
import { sealRun as sealRunDir } from "../context/seal.js";
import type { SignalRecorder } from "../learning/record.js";
import { createSignalHooks } from "../learning/signal-hooks.js";
import {
  computeQueueWaitMs,
  createPipelineTimingMetrics,
  loadPrimaryReviewRunMeta,
} from "../learning/pipeline-signals.js";
import {
  computeRunContext,
  finalizeCoverage,
  materializeDiffArtifact,
  materializeFinalCoverage,
  materializeRunContext,
  type ContextBuildInput,
  type ContextBuildResult,
  type CoverageFinalization,
} from "./context-build.js";
import { prepareRegisteredSource } from "./source-pipeline.js";
import { resolveGithubRemote } from "./resolve-remote.js";
import { computeRunId, computeRunInputHash } from "./run-identity.js";
import { removeRunSourcePair } from "../source/cleanup.js";
import type { SourceManifest } from "../source/materialize.js";
import type { ProvenanceRecord } from "../context/provenance.js";

const defaultAppRoot = resolve(
  join(fileURLToPath(import.meta.url), "../../.."),
);

export type CursorAdapterFn = (
  input: AdapterRunInput,
) => Promise<AdapterRunResult>;

export interface PipelineRunnerContext {
  dataDirectory: string;
  signalRecorder?: SignalRecorder;
  modelSpecHash?: string;
  appRoot?: string;
  profileDirectory?: string;
  repositoryPaths?: Record<string, string>;
  protectedPaths?: string[];
  catalogRepositories?: Array<{ id: string; github: string }>;
  execGhText?: (args: string[], opts: { host: string }) => Promise<string>;
  githubHost?: string;
  cursorBinary?: string;
  cursorModelId?: string;
  cursorHomePath?: string;
  sshAuthSock?: string;
  runAgent?: PipelineDeps["runAgent"];
  cursorAdapter?: CursorAdapterFn;
}

interface PreparedRunState {
  coverage: CoverageObject;
  manifest: HarnessManifest;
  provenanceCatalog: ProvenanceRecord[];
  sourceManifest: SourceManifest | null;
  sourceViewRoot: string | null;
  layout: ReturnType<typeof computeRunDirectoryLayout>;
  artifactSetHash: string;
  provenanceCatalogHash: string;
  diffFilterOutcome?: DiffFilterOutcome;
  diffOmittedPaths?: Array<{ path: string; reason: string }>;
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

function resolveCursorHome(ctx: PipelineRunnerContext): string {
  return (
    ctx.cursorHomePath ??
    process.env.CONTROL_TOWER_CURSOR_HOME ??
    process.env.HOME ??
    homedir()
  );
}

function resolveReviewPrompt(appRoot: string): string {
  const promptPath = join(appRoot, "config/harnesses/pr-review/prompt.md");
  try {
    return readFileSync(promptPath, "utf-8");
  } catch {
    return "Review this pull request and return a single JSON object matching the output contract.";
  }
}

export function buildPipelineDeps(
  db: Database.Database,
  ctx: PipelineRunnerContext,
  jobId: string,
): PipelineDeps {
  const transitions: PipelineDeps["transitions"] = [];
  const runTransitions: PipelineDeps["runTransitions"] = [];
  const pipelineStartedAt = Date.now();
  const timing = createPipelineTimingMetrics();
  timing.queueWaitMs = computeQueueWaitMs(db, jobId, pipelineStartedAt);
  const modelSpecHash = ctx.modelSpecHash ?? "primary-review-default";
  const appRoot = ctx.appRoot ?? defaultAppRoot;
  const activeRunId = { value: "" };
  const prepared = {
    state: null as PreparedRunState | null,
    job: null as PipelineJob | null,
  };

  const signalHooks = ctx.signalRecorder
    ? createSignalHooks({
        recorder: ctx.signalRecorder,
        getRunMeta: () =>
          loadPrimaryReviewRunMeta(
            db,
            jobId,
            activeRunId.value || "pending",
            modelSpecHash,
          ),
      })
    : undefined;

  function buildProvenanceDeps(): ContextBuildInput["provenanceDeps"] {
    return {
      queryPrChecks: (repoKey: string, prNum: number) => {
        return db
          .prepare(
            `SELECT pc.id, pc.name, pc.status, pc.conclusion, pc.details_url
             FROM pr_checks pc
             JOIN prs p ON p.id = pc.pr_id
             WHERE p.repository_id = ? AND p.pr_number = ?`,
          )
          .all(repoKey, prNum) as Array<{
            id: number;
            name: string;
            status: string;
            conclusion: string | null;
            details_url: string | null;
          }>;
      },
      queryPrComments: (repoKey: string, prNum: number) => {
        return db
          .prepare(
            `SELECT pc.id, pc.author_login, pc.body, pc.created_at, pc.url
             FROM pr_comments pc
             JOIN prs p ON p.id = pc.pr_id
             WHERE p.repository_id = ? AND p.pr_number = ?`,
          )
          .all(repoKey, prNum) as Array<{
            id: number;
            author_login: string;
            body: string;
            created_at: string;
            url: string | null;
          }>;
      },
      queryPrFetchedAt: (repoKey: string, prNum: number) => {
        const row = db
          .prepare(
            `SELECT fetched_at FROM prs WHERE repository_id = ? AND pr_number = ?`,
          )
          .get(repoKey, prNum) as { fetched_at: string } | undefined;
        return row?.fetched_at ?? null;
      },
    };
  }

  function buildContextInput(
    job: PipelineJob,
    runId: string,
  ): ContextBuildInput {
    const repoRow = db
      .prepare(`SELECT github_owner, github_repo FROM repositories WHERE id = ?`)
      .get(job.repositoryKey) as
      | { github_owner: string; github_repo: string }
      | undefined;
    const ownerRepo = repoRow
      ? `${repoRow.github_owner}/${repoRow.github_repo}`
      : undefined;

    const prRow = db
      .prepare(
        `SELECT base_sha FROM prs
         WHERE repository_id = ? AND pr_number = ?`,
      )
      .get(job.repositoryKey, job.prNumber) as
      | { base_sha: string }
      | undefined;

    return {
      appRoot,
      dataDirectory: ctx.dataDirectory,
      profileDirectory: ctx.profileDirectory,
      jobId,
      runId,
      repositoryKey: job.repositoryKey,
      prNumber: job.prNumber,
      headSha: job.headSha,
      sourceMode: job.sourceMode,
      policyHash: job.policyHash,
      modelSpecHash,
      protectedPaths: ctx.protectedPaths,
      execGhText: ctx.execGhText,
      githubHost: ctx.githubHost,
      ownerRepo,
      baseSha: prRow?.base_sha,
      provenanceDeps: buildProvenanceDeps(),
    };
  }

  function persistFinalCoverage(
    runId: string,
    finalization: CoverageFinalization,
    built: ContextBuildResult,
  ): CoverageObject {
    if (!prepared.state || !prepared.job) {
      throw new Error("prepared state missing for coverage finalization");
    }

    const coverage = finalizeCoverage(prepared.job.sourceMode, finalization);
    const { runInputHash } = materializeFinalCoverage(
      built.layout,
      coverage,
      {
        harnessManifestHash: built.manifest.manifestHash,
        artifactSetHash: built.artifactSetHash,
        provenanceCatalogHash: built.provenanceCatalogHash,
        modelSpecificationHash: modelSpecHash,
      },
      { runId, jobId, modelSpecHash },
      built.manifest,
      built.provenanceCatalog,
    );

    db.prepare(`UPDATE runs SET run_input_hash = ? WHERE id = ?`).run(
      runInputHash,
      runId,
    );

    prepared.state.coverage = coverage;
    return coverage;
  }

  return {
    transitions,
    runTransitions,
    signalHooks,
    getTimingMetrics: () => timing,
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
      const job = loadPipelineJob(db, jobId);
      if (!job) throw new Error(`queued job not found: ${jobId}`);
      prepared.job = job;

      const maxAttempt =
        (
          db
            .prepare(
              `SELECT MAX(attempt_number) as n FROM runs WHERE job_id = ?`,
            )
            .get(jobId) as { n: number | null }
        ).n ?? 0;
      const attemptNumber = maxAttempt + 1;

      const provisionalRunId = `pending-${jobId}-${attemptNumber}`;
      const contextInput = buildContextInput(job, provisionalRunId);
      const built = computeRunContext(contextInput);

      const allocationRunInputHash = computeRunInputHash({
        harnessManifestHash: built.manifest.manifestHash,
        artifactSetHash: built.artifactSetHash,
        sourceHash: "",
        provenanceCatalogHash: built.provenanceCatalogHash,
        modelSpecificationHash: modelSpecHash,
      });
      const runId = computeRunId(jobId, allocationRunInputHash, attemptNumber);
      activeRunId.value = runId;

      db.prepare(
        `INSERT INTO runs (id, job_id, attempt_number, run_input_hash, state, version, started_at)
         VALUES (?, ?, ?, ?, 'allocated', 1, ?)`,
      ).run(
        runId,
        jobId,
        attemptNumber,
        allocationRunInputHash,
        new Date().toISOString(),
      );
      db.prepare(
        `UPDATE jobs SET latest_run_id = ?, updated_at = ? WHERE id = ?`,
      ).run(runId, new Date().toISOString(), jobId);

      prepared.state = {
        coverage: built.coverage,
        manifest: built.manifest,
        provenanceCatalog: built.provenanceCatalog,
        sourceManifest: null,
        sourceViewRoot: null,
        layout: built.layout,
        artifactSetHash: built.artifactSetHash,
        provenanceCatalogHash: built.provenanceCatalogHash,
      };

      return { runId, version: 1 };
    },
    async prepareContext(jobId, runId) {
      const contextStart = Date.now();
      const job = prepared.job ?? loadPipelineJob(db, jobId);
      if (!job) throw new Error(`job not found: ${jobId}`);

      const contextInput = buildContextInput(job, runId);
      const built = computeRunContext(contextInput);

      materializeRunContext(contextInput, built);

      const diffResult = await materializeDiffArtifact(contextInput, built.layout);
      const diffOmittedPaths = diffResult.omittedPaths.map((path) => ({
        path,
        reason: "protected_path_content",
      }));

      if (prepared.state) {
        prepared.state.coverage = built.coverage;
        prepared.state.manifest = built.manifest;
        prepared.state.provenanceCatalog = built.provenanceCatalog;
        prepared.state.layout = built.layout;
        prepared.state.artifactSetHash = built.artifactSetHash;
        prepared.state.provenanceCatalogHash = built.provenanceCatalogHash;
        prepared.state.diffFilterOutcome = diffResult.outcome;
        prepared.state.diffOmittedPaths = diffOmittedPaths;
      }

      let finalCoverage = built.coverage;
      if (job.sourceMode === "remote-evidence-only") {
        finalCoverage = persistFinalCoverage(
          runId,
          {
            diffFilterOutcome: diffResult.outcome,
            diffOmittedPaths,
            sourceTreeInspected: false,
            sourceOmittedPaths: [],
            sourceOmittedEntries: [],
          },
          built,
        );
      }

      timing.contextPrepMs += Date.now() - contextStart;
      return {
        runDir: built.runDir,
        manifest: built.manifest as unknown as Record<string, unknown>,
        coverage: finalCoverage as unknown as Record<string, unknown>,
      };
    },
    async prepareSource(jobId, runId) {
      const job = prepared.job ?? loadPipelineJob(db, jobId);
      if (!job) throw new Error(`job not found: ${jobId}`);

      const resolved = resolveGithubRemote(
        {
          queryRepository: (key) => {
            const row = db
              .prepare(
                `SELECT github_owner, github_repo FROM repositories WHERE id = ?`,
              )
              .get(key) as
              | { github_owner: string; github_repo: string }
              | undefined;
            return row ?? null;
          },
          catalogRepositories: ctx.catalogRepositories ?? [],
        },
        job.repositoryKey,
      );

      const result = await prepareRegisteredSource({
        dataDirectory: ctx.dataDirectory,
        jobId,
        repositoryKey: job.repositoryKey,
        prNumber: job.prNumber,
        headSha: job.headSha,
        repositoryPath: ctx.repositoryPaths?.[job.repositoryKey],
        githubRemote: resolved?.remote,
        homePath: resolveCursorHome(ctx),
        sshAuthSock: ctx.sshAuthSock ?? process.env.SSH_AUTH_SOCK,
        protectedPaths: ctx.protectedPaths ?? [],
      });

      if (prepared.state) {
        prepared.state.sourceManifest = result.sourceManifest;
        prepared.state.sourceViewRoot = result.sourceViewRoot;

        const sourceOmitted = result.sourceManifest.omitted.map((o) => ({
          path: o.path,
          reason: o.reason,
        }));
        const contextInput = buildContextInput(job, runId);
        const built = computeRunContext(contextInput);
        persistFinalCoverage(
          runId,
          {
            diffFilterOutcome: prepared.state.diffFilterOutcome ?? "not_run",
            diffOmittedPaths: prepared.state.diffOmittedPaths ?? [],
            sourceTreeInspected: true,
            sourceOmittedPaths: sourceOmitted.filter(
              (o) => o.reason === "protected_path_content",
            ),
            sourceOmittedEntries: sourceOmitted,
          },
          {
            ...built,
            layout: prepared.state.layout,
            manifest: prepared.state.manifest,
            provenanceCatalog: prepared.state.provenanceCatalog,
            artifactSetHash: prepared.state.artifactSetHash,
            provenanceCatalogHash: prepared.state.provenanceCatalogHash,
          },
        );
      }

      return {
        sourceViewRoot: result.sourceViewRoot,
        adminWorktree: result.adminWorktree,
      };
    },
    async runAgent(runId, runDir) {
      if (ctx.runAgent) {
        return await Promise.resolve(ctx.runAgent(runId, runDir));
      }

      const agentStart = Date.now();
      const layout = computeRunDirectoryLayout(ctx.dataDirectory, jobId, runId);
      const prompt = resolveReviewPrompt(appRoot);
      const adapter = ctx.cursorAdapter ?? runCursorAgent;
      const binary =
        ctx.cursorBinary ??
        process.env.CONTROL_TOWER_CURSOR_BINARY ??
        "agent";
      const modelId =
        ctx.cursorModelId ??
        process.env.CONTROL_TOWER_CURSOR_MODEL ??
        "primary-review-default";

      const result = await adapter({
        role: "primaryReview",
        binary,
        runDirectory: runDir,
        modelId,
        prompt,
        sourceViewPath: prepared.state?.sourceViewRoot ?? undefined,
        homePath: resolveCursorHome(ctx),
        transcriptPath: layout.transcriptPath,
        stderrPath: layout.stderrPath,
      });

      timing.agentDurationMs += Date.now() - agentStart;
      timing.cursorUsage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      };

      if (!result.success || !result.resultText) {
        throw new Error(result.failureReason ?? "agent_failed");
      }

      const extractedJson = extractJsonFromResult(result.resultText);
      if (!extractedJson) {
        throw new Error("agent output does not contain valid JSON");
      }

      writeFileSync(layout.outputPath, extractedJson, "utf-8");

      return {
        rawOutput: extractedJson,
        exitCode: result.exitCode ?? 0,
        modelId: result.actualModel ?? modelId,
      };
    },
    validateOutput(rawOutput, coverage) {
      const job = prepared.job;
      const sourceMode = job?.sourceMode ?? "remote-evidence-only";
      const finalCoverage = prepared.state?.coverage ?? (coverage as unknown as CoverageObject);
      const catalog = new Map(
        (prepared.state?.provenanceCatalog ?? []).map((record) => [
          record.id,
          record,
        ]),
      );
      const sourceManifestEntries = prepared.state?.sourceManifest?.allowed ?? [];
      const sourceManifest = new Map(
        sourceManifestEntries.map((entry) => [
          entry.path,
          { blobSha: entry.blobSha, lineCount: entry.lineCount },
        ]),
      );

      try {
        const parsed = JSON.parse(rawOutput);
        const result = validateReviewOutput(parsed, {
          coverage: finalCoverage,
          catalog,
          sourceManifest,
          sourceMode,
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
    cleanupSource() {
      void removeRunSourcePair(ctx.dataDirectory, jobId).catch(() => {});
    },
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
  const deps = buildPipelineDeps(db, ctx, jobId);
  await executePipeline(deps, job);
}
