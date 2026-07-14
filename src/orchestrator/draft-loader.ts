import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { computeRunDirectoryLayout } from "../context/prepare.js";
import type { ReviewOutput } from "../cursor/validate-review.js";
import { createOperationPlan } from "../publisher/operation-plan.js";
import { computeOperationHash } from "../publisher/operation-hash.js";
import type { ExternalOperation } from "../publisher/operation-hash.js";
import type { DraftDetail, OperationPlanSummary } from "../api/contracts.js";

export interface DraftLoadContext {
  dataDirectory: string;
  principalLogin: string;
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function resolveRepositoryDisplay(
  db: Database.Database,
  repositoryKey: string,
): string {
  const row = db
    .prepare(`SELECT github_owner, github_repo FROM repositories WHERE id = ?`)
    .get(repositoryKey) as
    | { github_owner: string; github_repo: string }
    | undefined;
  return row ? `${row.github_owner}/${row.github_repo}` : repositoryKey;
}

function buildPlanInput(
  output: ReviewOutput,
  ctx: {
    principalLogin: string;
    repository: string;
    prNumber: number;
    headSha: string;
    acceptedRunId: string;
    runInputHash: string;
  },
) {
  const disposition = output.recommendedDisposition as
    | "comment"
    | "request_changes"
    | "approve"
    | "needs_human";
  const summaryBodyHash = createHash("sha256")
    .update(output.draftSummary.body)
    .digest("hex");
  const coverageHash = createHash("sha256")
    .update(JSON.stringify(output.coverage))
    .digest("hex");

  return {
    disposition,
    draft: {
      summaryBody: output.draftSummary.body,
      summaryBodyHash,
      summaryProvenanceIds: output.draftSummary.provenanceRefs,
      findings: output.findings
        .filter((f) => f.location !== null)
        .map((f) => ({
          title: f.title,
          draftComment: f.draftComment,
          location: {
            path: f.file,
            side: f.location!.side as "LEFT" | "RIGHT",
            line: f.location!.line,
            startSide: f.location!.startSide as "LEFT" | "RIGHT" | null,
            startLine: f.location!.startLine,
          },
          observationProvenanceIds: f.observationIndexes
            .map((idx) => output.observations[idx]?.provenanceRefs ?? [])
            .flat(),
        })),
    },
    principalLogin: ctx.principalLogin,
    repository: ctx.repository,
    prNumber: ctx.prNumber,
    headSha: ctx.headSha,
    acceptedRunId: ctx.acceptedRunId,
    runInputHash: ctx.runInputHash,
    coverageHash,
  };
}

function toOperationPlanSummary(
  operations: ExternalOperation[],
  draftSummaryUse: string,
): OperationPlanSummary {
  return {
    draftSummaryUse,
    operations: operations.map((op) => ({
      type: op.type,
      event: op.event,
      operationHash: computeOperationHash(op),
    })),
  };
}

const DRAFT_READY_STATES = new Set([
  "draft_ready",
  "awaiting_approval",
  "publishing",
]);

export interface DraftBundle {
  detail: DraftDetail;
  operations: ExternalOperation[];
  runInputHash: string;
  headSha: string;
  acceptedRunId: string;
}

export function loadDraftBundle(
  db: Database.Database,
  jobId: string,
  ctx: DraftLoadContext,
): DraftBundle | null {
  const job = db
    .prepare(
      `SELECT id, repository_key, pr_number, head_sha, state, accepted_run_id
       FROM jobs WHERE id = ?`,
    )
    .get(jobId) as
    | {
        id: string;
        repository_key: string;
        pr_number: number;
        head_sha: string;
        state: string;
        accepted_run_id: string | null;
      }
    | undefined;

  if (!job || !job.accepted_run_id || !DRAFT_READY_STATES.has(job.state)) {
    return null;
  }

  const prRow = db
    .prepare(
      `SELECT head_sha FROM prs WHERE repository_id = ? AND pr_number = ?`,
    )
    .get(job.repository_key, job.pr_number) as { head_sha: string } | undefined;

  const currentHeadSha = prRow?.head_sha ?? job.head_sha;
  const stale = currentHeadSha !== job.head_sha;

  const run = db
    .prepare(`SELECT id, run_input_hash FROM runs WHERE id = ?`)
    .get(job.accepted_run_id) as
    | { id: string; run_input_hash: string }
    | undefined;
  if (!run) return null;

  const layout = computeRunDirectoryLayout(ctx.dataDirectory, jobId, run.id);
  const output = readJsonFile<ReviewOutput>(layout.outputPath);
  if (!output) return null;

  const validatedProvenance =
    readJsonFile<Record<string, unknown>[]>(layout.validatedProvenancePath) ??
    [];

  const repository = resolveRepositoryDisplay(db, job.repository_key);
  const planInput = buildPlanInput(output, {
    principalLogin: ctx.principalLogin,
    repository,
    prNumber: job.pr_number,
    headSha: job.head_sha,
    acceptedRunId: run.id,
    runInputHash: run.run_input_hash,
  });

  const fullPlan = createOperationPlan(planInput);
  const operationPlan =
    planInput.disposition === "needs_human"
      ? { draftSummaryUse: "not_published", operations: [] }
      : toOperationPlanSummary(fullPlan.operations, fullPlan.draftSummaryUse);

  const detail: DraftDetail = {
    jobId,
    runId: run.id,
    summary: output.summary,
    draftSummary: output.draftSummary,
    findings: output.findings,
    observations: output.observations.map((o) => ({
      type: o.type,
      statement: o.statement,
      provenanceRefs: o.provenanceRefs,
    })),
    checks: output.checks.map((c) => ({
      name: c.name,
      status: c.status,
      provenanceRef: c.provenanceRef,
    })),
    coverage: {
      mode: output.coverage.mode,
      sourceTreeInspected: output.coverage.sourceTreeInspected,
      diffFiltered: output.coverage.diffFiltered,
      omittedProtectedPaths: output.coverage.omittedProtectedPaths.map(
        (p) => p.path,
      ),
      missingCoverage: output.coverage.missingCoverage,
    },
    unknowns: output.unknowns,
    recommendedDisposition: output.recommendedDisposition,
    validatedProvenance,
    operationPlan,
    reviewedHeadSha: job.head_sha,
    currentHeadSha,
    stale,
  };

  return {
    detail,
    operations: fullPlan.operations,
    runInputHash: run.run_input_hash,
    headSha: job.head_sha,
    acceptedRunId: run.id,
  };
}

export function loadDraftDetail(
  db: Database.Database,
  jobId: string,
  ctx: DraftLoadContext,
): DraftDetail | null {
  return loadDraftBundle(db, jobId, ctx)?.detail ?? null;
}

export function loadDraftOperations(
  db: Database.Database,
  jobId: string,
  ctx: DraftLoadContext,
): { operations: ExternalOperation[]; runInputHash: string; headSha: string } | null {
  const bundle = loadDraftBundle(db, jobId, ctx);
  if (!bundle || bundle.operations.length === 0) return null;
  return {
    operations: bundle.operations,
    runInputHash: bundle.runInputHash,
    headSha: bundle.headSha,
  };
}
