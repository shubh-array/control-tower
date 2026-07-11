import { createHash } from "node:crypto";

export type OperationType =
  | "inline_comment"
  | "summary_comment"
  | "comment_review"
  | "request_changes_review"
  | "approve_review";

export type GitHubReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

export type DraftSummaryUse =
  | "review_body"
  | "separate_summary"
  | "not_published";

export interface InlineTarget {
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  startSide: "LEFT" | "RIGHT" | null;
  startLine: number | null;
}

export interface ExternalOperation {
  type: OperationType;
  event: GitHubReviewEvent | null;
  principalLogin: string;
  repository: string;
  prNumber: number;
  target: InlineTarget | null;
  bodyHash: string | null;
  disposition: string;
  draftSummaryUse: DraftSummaryUse;
  summaryBodyHash: string | null;
  headSha: string;
  acceptedRunId: string;
  runInputHash: string;
  coverageHash: string;
  provenanceIds: string[];
  idempotencyKey: string;
}

export function computeOperationHash(op: ExternalOperation): string {
  const parts: string[] = [
    op.type,
    op.event ?? "null",
    op.principalLogin,
    op.repository,
    String(op.prNumber),
    op.target
      ? `${op.target.path}:${op.target.side}:${op.target.line}:${op.target.startSide ?? "null"}:${op.target.startLine ?? "null"}`
      : "null",
    op.bodyHash ?? "null",
    op.disposition,
    op.draftSummaryUse,
    op.summaryBodyHash ?? "null",
    op.headSha,
    op.acceptedRunId,
    op.runInputHash,
    op.coverageHash,
    [...op.provenanceIds].sort().join(","),
    op.idempotencyKey,
  ];

  return createHash("sha256").update(parts.join("\n")).digest("hex");
}
