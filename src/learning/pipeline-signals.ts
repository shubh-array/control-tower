import type Database from "better-sqlite3";
import type { SignalRecorder } from "./record.js";
import { createSignalHooks, type RunMeta, type SignalHooks } from "./signal-hooks.js";
import type { DispositionSignal, FailureSignal } from "./signals.js";
import { sha256Hex } from "../util/hash.js";
import type { OperationType } from "../publisher/operation-hash.js";

export interface PipelineTimingMetrics {
  queueWaitMs: number;
  contextPrepMs: number;
  agentDurationMs: number;
  cursorUsage: { inputTokens: number; outputTokens: number };
}

export function createPipelineTimingMetrics(): PipelineTimingMetrics {
  return {
    queueWaitMs: 0,
    contextPrepMs: 0,
    agentDurationMs: 0,
    cursorUsage: { inputTokens: 0, outputTokens: 0 },
  };
}

export function loadPrimaryReviewRunMeta(
  db: Database.Database,
  jobId: string,
  runId: string,
  modelSpecHash: string,
): RunMeta {
  const job = db
    .prepare(
      `SELECT policy_hash, source_mode, queued_at FROM jobs WHERE id = ?`,
    )
    .get(jobId) as
    | { policy_hash: string; source_mode: RunMeta["sourceMode"]; queued_at: string | null }
    | undefined;

  const run = db
    .prepare(`SELECT run_input_hash FROM runs WHERE id = ?`)
    .get(runId) as { run_input_hash: string } | undefined;

  return {
    jobId,
    runId,
    policyDecisionHash: job?.policy_hash ?? "unknown",
    runInputHash: run?.run_input_hash ?? "unknown",
    modelRole: "primaryReview",
    modelSpecHash,
    harnessManifestHash: "phase1-primary-review",
    contextHash: sha256Hex(`${jobId}:${runId}`),
    provenanceSchemaVersion: 1,
    sourceMode: job?.source_mode ?? "registered-source",
  };
}

export function createPrimaryReviewSignalHooks(
  db: Database.Database,
  recorder: SignalRecorder,
  jobId: string,
  runId: string,
  modelSpecHash: string,
): SignalHooks {
  return createSignalHooks({
    recorder,
    getRunMeta: () => loadPrimaryReviewRunMeta(db, jobId, runId, modelSpecHash),
  });
}

export function computeQueueWaitMs(
  db: Database.Database,
  jobId: string,
  pipelineStartedAt: number,
): number {
  const row = db
    .prepare(`SELECT queued_at FROM jobs WHERE id = ?`)
    .get(jobId) as { queued_at: string | null } | undefined;
  if (!row?.queued_at) return 0;
  const queuedAt = Date.parse(row.queued_at);
  if (Number.isNaN(queuedAt)) return 0;
  return Math.max(0, pipelineStartedAt - queuedAt);
}

export function mapFailureReason(
  failureReason: string,
): Pick<FailureSignal, "failureCategory" | "failureCode" | "retryOf"> {
  switch (failureReason) {
    case "fetch_failed":
      return { failureCategory: "connector", failureCode: failureReason, retryOf: null };
    case "materialize_failed":
      return { failureCategory: "source", failureCode: failureReason, retryOf: null };
    case "agent_failed":
      return { failureCategory: "agent", failureCode: failureReason, retryOf: null };
    case "allocation_failed":
      return { failureCategory: "validation", failureCode: failureReason, retryOf: null };
    default:
      return { failureCategory: "agent", failureCode: failureReason, retryOf: null };
  }
}

export function mapRecommendedDisposition(
  disposition: string,
): DispositionSignal["finalDisposition"] {
  switch (disposition) {
    case "approve":
      return "approve";
    case "comment":
      return "comment";
    case "request_changes":
      return "request_changes";
    case "needs_human":
      return "no_publication";
    default:
      return "no_publication";
  }
}

export function mapOperationTypeToDisposition(
  operationType: OperationType,
): DispositionSignal["finalDisposition"] {
  switch (operationType) {
    case "approve_review":
      return "approve";
    case "comment_review":
      return "comment";
    case "request_changes_review":
      return "request_changes";
    case "inline_comment":
    case "summary_comment":
      return "comment";
    default:
      return "no_publication";
  }
}

export function mapAdvisorToAttentionOutcome(input: {
  advisorRelevance: string | null;
  advisorRisk: string | null;
  advisorRecommendedAction: string | null;
}): "relevant" | "ignored" | "escalated" {
  const action = input.advisorRecommendedAction?.toLowerCase() ?? "";
  const risk = input.advisorRisk?.toLowerCase() ?? "";
  if (action.includes("escalat") || risk === "high" || risk === "critical") {
    return "escalated";
  }
  const relevance = input.advisorRelevance?.toLowerCase() ?? "";
  if (relevance === "low" || relevance === "none") {
    return "ignored";
  }
  return "relevant";
}

export function createAttentionSignalHooks(
  db: Database.Database,
  recorder: SignalRecorder,
  repositoryKey: string,
  prNumber: number,
  attentionItemId: string,
  modelSpecHash: string,
): SignalHooks {
  const row = db
    .prepare(
      `SELECT source_mode, policy_hash FROM attention_items
       WHERE repository_key = ? AND pr_number = ?`,
    )
    .get(repositoryKey, prNumber) as
    | { source_mode: RunMeta["sourceMode"]; policy_hash: string | null }
    | undefined;

  return createSignalHooks({
    recorder,
    getRunMeta: () => ({
      jobId: `attention:${repositoryKey}:${prNumber}`,
      runId: attentionItemId,
      policyDecisionHash: row?.policy_hash ?? "unknown",
      runInputHash: sha256Hex(`${repositoryKey}:${prNumber}`),
      modelRole: "attention",
      modelSpecHash,
      harnessManifestHash: "phase1-attention",
      contextHash: sha256Hex(`${repositoryKey}:${prNumber}:${attentionItemId}`),
      provenanceSchemaVersion: 1,
      sourceMode: row?.source_mode ?? "registered-source",
    }),
  });
}
