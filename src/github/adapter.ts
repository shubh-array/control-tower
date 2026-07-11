import {
  execGhStdoutStream,
  GhProcessError,
  type GhExecOptions,
} from "./gh-process.js";
import { StreamingDiffFilter } from "./diff-filter.js";
import type {
  DiffFilterResult,
  GhPrListItem,
  GhPrViewResult,
  GhSearchPrItem,
} from "./types.js";

type ExecGhJsonFn = <T>(args: string[], options: GhExecOptions) => Promise<T>;
type CanonicalizeFn = (rawPath: string) => string | null;
type IsProtectedFn = (canonicalPath: string) => boolean;

const SEARCH_PR_FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "author",
  "repository",
  "headRefOid",
  "baseRefOid",
  "labels",
  "additions",
  "deletions",
  "createdAt",
  "updatedAt",
  "reviewRequests",
].join(",");

const LIST_PR_FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "author",
  "headRefOid",
  "baseRefOid",
  "headRefName",
  "baseRefName",
  "labels",
  "additions",
  "deletions",
  "createdAt",
  "updatedAt",
  "reviewRequests",
  "statusCheckRollup",
].join(",");

const VIEW_PR_FIELDS = [
  ...LIST_PR_FIELDS.split(","),
  "body",
  "files",
  "reviews",
  "comments",
  "commits",
].join(",");

export class GitHubAdapter {
  constructor(
    private readonly host: string,
    private readonly execJson: ExecGhJsonFn,
  ) {}

  private opts(): GhExecOptions {
    return { host: this.host };
  }

  async searchReviewRequested(
    login: string,
    organizations: string[],
  ): Promise<GhSearchPrItem[]> {
    const results: GhSearchPrItem[] = [];

    for (const organization of organizations) {
      const items = await this.execJson<GhSearchPrItem[]>(
        [
          "search",
          "prs",
          "--owner",
          organization,
          `--review-requested=${login}`,
          "--state=open",
          "--json",
          SEARCH_PR_FIELDS,
        ],
        this.opts(),
      );

      results.push(...items);
    }

    return results;
  }

  async listRepoPrs(ownerRepo: string): Promise<GhPrListItem[]> {
    return this.execJson<GhPrListItem[]>(
      [
        "pr",
        "list",
        "--repo",
        ownerRepo,
        "--state",
        "open",
        "--json",
        LIST_PR_FIELDS,
      ],
      this.opts(),
    );
  }

  async viewPr(ownerRepo: string, prNumber: number): Promise<GhPrViewResult> {
    return this.execJson<GhPrViewResult>(
      [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        ownerRepo,
        "--json",
        VIEW_PR_FIELDS,
      ],
      this.opts(),
    );
  }

  async getFilteredPrDiff(
    ownerRepo: string,
    prNumber: number,
    canonicalize: CanonicalizeFn,
    isProtected: IsProtectedFn,
  ): Promise<DiffFilterResult> {
    const filter = new StreamingDiffFilter(canonicalize, isProtected);
    const exitCode = await execGhStdoutStream(
      ["pr", "diff", String(prNumber), "--repo", ownerRepo],
      this.opts(),
      (chunk) => filter.pushChunk(chunk),
    );

    if (exitCode !== 0) {
      throw new GhProcessError(
        ["pr", "diff", String(prNumber), "--repo", ownerRepo],
        exitCode,
        `gh exited with code ${exitCode}`,
      );
    }

    return filter.finish();
  }

  /**
   * @deprecated Use getFilteredPrDiff to avoid buffering protected diff content.
   */
  async getPrDiff(_ownerRepo: string, _prNumber: number): Promise<string> {
    throw new Error(
      "getPrDiff is deprecated: use getFilteredPrDiff to avoid buffering protected diff content",
    );
  }
}
