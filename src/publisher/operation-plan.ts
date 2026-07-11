import { createHash } from "node:crypto";
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

function serializeTarget(target: InlineTarget | null): string {
  return target
    ? `${target.path}:${target.side}:${target.line}:${target.startSide ?? "null"}:${target.startLine ?? "null"}`
    : "null";
}

function makeIdempotencyKey(
  prefix: string,
  fields: {
    type: string;
    event: string | null;
    principalLogin: string;
    repository: string;
    prNumber: number;
    target: InlineTarget | null;
    bodyHash: string | null;
    disposition: string;
    draftSummaryUse: string;
    summaryBodyHash: string | null;
    headSha: string;
    acceptedRunId: string;
    runInputHash: string;
    coverageHash: string;
  },
): string {
  const parts = [
    prefix,
    fields.type,
    fields.event ?? "null",
    fields.principalLogin,
    fields.repository,
    String(fields.prNumber),
    serializeTarget(fields.target),
    fields.bodyHash ?? "null",
    fields.disposition,
    fields.draftSummaryUse,
    fields.summaryBodyHash ?? "null",
    fields.headSha,
    fields.acceptedRunId,
    fields.runInputHash,
    fields.coverageHash,
  ];
  const hash = createHash("sha256").update(parts.join("\n")).digest("hex");
  return `${prefix}-${hash}`;
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
  return input.draft.findings.map((f) => {
    const bodyHash = createHash("sha256").update(f.draftComment).digest("hex");
    const draftSummaryUse = "not_published" as const;
    return {
      ...common,
      type: "inline_comment" as const,
      event: null,
      target: f.location,
      bodyHash,
      provenanceIds: f.observationProvenanceIds,
      idempotencyKey: makeIdempotencyKey("inline", {
        type: "inline_comment",
        event: null,
        principalLogin: common.principalLogin,
        repository: common.repository,
        prNumber: common.prNumber,
        target: f.location,
        bodyHash,
        disposition: common.disposition,
        draftSummaryUse,
        summaryBodyHash: null,
        headSha: common.headSha,
        acceptedRunId: common.acceptedRunId,
        runInputHash: common.runInputHash,
        coverageHash: common.coverageHash,
      }),
      draftSummaryUse,
      summaryBodyHash: null,
    };
  });
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

    const draftSummaryUse = "review_body" as const;
    ops.push({
      ...common,
      type: reviewType,
      event,
      target: null,
      bodyHash: input.draft.summaryBodyHash,
      provenanceIds: input.draft.summaryProvenanceIds,
      idempotencyKey: makeIdempotencyKey("review", {
        type: reviewType,
        event,
        principalLogin: common.principalLogin,
        repository: common.repository,
        prNumber: common.prNumber,
        target: null,
        bodyHash: input.draft.summaryBodyHash,
        disposition: common.disposition,
        draftSummaryUse,
        summaryBodyHash: input.draft.summaryBodyHash,
        headSha: common.headSha,
        acceptedRunId: common.acceptedRunId,
        runInputHash: common.runInputHash,
        coverageHash: common.coverageHash,
      }),
      draftSummaryUse,
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
    idempotencyKey: makeIdempotencyKey("approve", {
      type: "approve_review",
      event: "APPROVE",
      principalLogin: common.principalLogin,
      repository: common.repository,
      prNumber: common.prNumber,
      target: null,
      bodyHash: null,
      disposition: common.disposition,
      draftSummaryUse: summaryUse,
      summaryBodyHash: publishSummary ? input.draft.summaryBodyHash : null,
      headSha: common.headSha,
      acceptedRunId: common.acceptedRunId,
      runInputHash: common.runInputHash,
      coverageHash: common.coverageHash,
    }),
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
      idempotencyKey: makeIdempotencyKey("summary", {
        type: "summary_comment",
        event: null,
        principalLogin: common.principalLogin,
        repository: common.repository,
        prNumber: common.prNumber,
        target: null,
        bodyHash: input.draft.summaryBodyHash,
        disposition: common.disposition,
        draftSummaryUse: summaryUse,
        summaryBodyHash: input.draft.summaryBodyHash,
        headSha: common.headSha,
        acceptedRunId: common.acceptedRunId,
        runInputHash: common.runInputHash,
        coverageHash: common.coverageHash,
      }),
      draftSummaryUse: summaryUse,
      summaryBodyHash: input.draft.summaryBodyHash,
    });
  }

  ops.push(...buildInlineOps(input, common));

  return { draftSummaryUse: summaryUse, operations: ops };
}
