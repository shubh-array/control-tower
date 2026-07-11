import { randomBytes, createHash } from "node:crypto";
import type {
  ExternalOperation,
  DraftSummaryUse,
  InlineTarget,
  GitHubReviewEvent,
} from "./operation-hash.js";

export interface FindingDraft {
  title: string;
  draftComment: string;
  location: InlineTarget;
  observationProvenanceIds: string[];
}

export interface DraftContent {
  summaryBody: string;
  summaryBodyHash: string;
  summaryProvenanceIds: string[];
  findings: FindingDraft[];
}

export interface PlanInput {
  disposition: "comment" | "request_changes" | "approve" | "needs_human";
  draft: DraftContent;
  principalLogin: string;
  repository: string;
  prNumber: number;
  headSha: string;
  acceptedRunId: string;
  runInputHash: string;
  coverageHash: string;
  publishSummary?: boolean;
}

export interface OperationPlan {
  draftSummaryUse: DraftSummaryUse;
  operations: ExternalOperation[];
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString("hex")}`;
}

function buildCommon(
  input: PlanInput,
): Omit<ExternalOperation, "type" | "event" | "target" | "bodyHash" | "provenanceIds" | "idempotencyKey" | "draftSummaryUse" | "summaryBodyHash"> {
  return {
    principalLogin: input.principalLogin,
    repository: input.repository,
    prNumber: input.prNumber,
    disposition: input.disposition,
    headSha: input.headSha,
    acceptedRunId: input.acceptedRunId,
    runInputHash: input.runInputHash,
    coverageHash: input.coverageHash,
  };
}

function buildInlineOps(
  input: PlanInput,
  common: ReturnType<typeof buildCommon>,
): ExternalOperation[] {
  return input.draft.findings.map((f) => ({
    ...common,
    type: "inline_comment" as const,
    event: null,
    target: f.location,
    bodyHash: createHash("sha256").update(f.draftComment).digest("hex"),
    provenanceIds: f.observationProvenanceIds,
    idempotencyKey: makeIdempotencyKey("inline"),
    draftSummaryUse: "not_published" as const,
    summaryBodyHash: null,
  }));
}

export function createOperationPlan(input: PlanInput): OperationPlan {
  if (input.disposition === "needs_human") {
    return { draftSummaryUse: "not_published", operations: [] };
  }

  const common = buildCommon(input);
  const ops: ExternalOperation[] = [];

  if (input.disposition === "comment" || input.disposition === "request_changes") {
    const event: GitHubReviewEvent =
      input.disposition === "comment" ? "COMMENT" : "REQUEST_CHANGES";
    const reviewType =
      input.disposition === "comment"
        ? ("comment_review" as const)
        : ("request_changes_review" as const);

    ops.push({
      ...common,
      type: reviewType,
      event,
      target: null,
      bodyHash: input.draft.summaryBodyHash,
      provenanceIds: input.draft.summaryProvenanceIds,
      idempotencyKey: makeIdempotencyKey("review"),
      draftSummaryUse: "review_body",
      summaryBodyHash: input.draft.summaryBodyHash,
    });

    ops.push(...buildInlineOps(input, common));

    return { draftSummaryUse: "review_body", operations: ops };
  }

  // disposition === "approve"
  const publishSummary = input.publishSummary ?? false;
  const summaryUse: DraftSummaryUse = publishSummary
    ? "separate_summary"
    : "not_published";

  ops.push({
    ...common,
    type: "approve_review",
    event: "APPROVE",
    target: null,
    bodyHash: null,
    provenanceIds: [],
    idempotencyKey: makeIdempotencyKey("approve"),
    draftSummaryUse: summaryUse,
    summaryBodyHash: publishSummary ? input.draft.summaryBodyHash : null,
  });

  if (publishSummary) {
    ops.push({
      ...common,
      type: "summary_comment",
      event: null,
      target: null,
      bodyHash: input.draft.summaryBodyHash,
      provenanceIds: input.draft.summaryProvenanceIds,
      idempotencyKey: makeIdempotencyKey("summary"),
      draftSummaryUse: summaryUse,
      summaryBodyHash: input.draft.summaryBodyHash,
    });
  }

  ops.push(...buildInlineOps(input, common));

  return { draftSummaryUse: summaryUse, operations: ops };
}
