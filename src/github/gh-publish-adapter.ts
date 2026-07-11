import { execGhJson } from "./gh-process.js";
import type { GhPublishAdapter } from "../publisher/publish.js";
import type { ExternalOperation } from "../publisher/operation-hash.js";

export function createGhPublishAdapter(host: string): GhPublishAdapter {
  return async (op: ExternalOperation, body: string | null) => {
    try {
      const [owner, repo] = op.repository.split("/");
      if (!owner || !repo) {
        return { ok: false, error: `Invalid repository: ${op.repository}` };
      }

      switch (op.type) {
        case "comment_review":
        case "request_changes_review": {
          const result = await execGhJson<{ id: number }>(
            [
              "api",
              `repos/${owner}/${repo}/pulls/${op.prNumber}/reviews`,
              "-f",
              `event=${op.event}`,
              "-f",
              `commit_id=${op.headSha}`,
              "-f",
              `body=${body ?? ""}`,
            ],
            { host, timeoutMs: 60_000 },
          );
          return { ok: true, githubId: String(result.id) };
        }
        case "approve_review": {
          const result = await execGhJson<{ id: number }>(
            [
              "api",
              `repos/${owner}/${repo}/pulls/${op.prNumber}/reviews`,
              "-f",
              "event=APPROVE",
              "-f",
              `commit_id=${op.headSha}`,
            ],
            { host, timeoutMs: 60_000 },
          );
          return { ok: true, githubId: String(result.id) };
        }
        case "summary_comment": {
          const result = await execGhJson<{ id: number }>(
            [
              "api",
              `repos/${owner}/${repo}/issues/${op.prNumber}/comments`,
              "-f",
              `body=${body ?? ""}`,
            ],
            { host, timeoutMs: 60_000 },
          );
          return { ok: true, githubId: String(result.id) };
        }
        case "inline_comment": {
          if (!op.target) {
            return { ok: false, error: "Inline comment missing target" };
          }
          const args = [
            "api",
            `repos/${owner}/${repo}/pulls/${op.prNumber}/comments`,
            "-f",
            `body=${body ?? ""}`,
            "-f",
            `commit_id=${op.headSha}`,
            "-f",
            `path=${op.target.path}`,
            "-F",
            `line=${op.target.line}`,
            "-f",
            `side=${op.target.side}`,
          ];
          if (op.target.startLine !== null && op.target.startSide !== null) {
            args.push("-F", `start_line=${op.target.startLine}`);
            args.push("-f", `start_side=${op.target.startSide}`);
          }
          const result = await execGhJson<{ id: number }>(args, {
            host,
            timeoutMs: 60_000,
          });
          return { ok: true, githubId: String(result.id) };
        }
        default:
          return { ok: false, error: `Unknown operation type: ${op.type}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
