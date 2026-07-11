import type {
  DiffFilterResult,
  FilteredDiffFile,
  OmittedDiffFile,
} from "./types.js";

type CanonicalizeFn = (rawPath: string) => string | null;
type IsProtectedFn = (canonicalPath: string) => boolean;

const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const COPY_FROM_RE = /^copy from (.+)$/;
const COPY_TO_RE = /^copy to (.+)$/;
const BINARY_RE = /^Binary files /;
const HUNK_RE = /^@@/;
const FILE_HEADER_RE = /^(---|\+\+\+) /;
const META_RE =
  /^(index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index )/;

export function filterDiff(
  diffText: string,
  canonicalize: CanonicalizeFn,
  isProtected: IsProtectedFn,
): DiffFilterResult {
  if (!diffText.trim()) {
    return { files: [], omitted: [], failed: false };
  }

  const filter = new StreamingDiffFilter(canonicalize, isProtected);
  for (const line of diffText.split("\n")) {
    filter.pushLine(line);
  }
  return filter.finish();
}

interface FileBlockState {
  rawPathA: string;
  rawPathB: string;
  renameFrom?: string;
  renameTo?: string;
  isBinary: boolean;
  patchLines: string[];
}

export class StreamingDiffFilter {
  private readonly files: FilteredDiffFile[] = [];
  private readonly omitted: OmittedDiffFile[] = [];
  private failed = false;
  private failureReason: string | undefined;
  private lineBuffer = "";
  private lineNumber = 0;
  private currentBlock: FileBlockState | null = null;

  constructor(
    private readonly canonicalize: CanonicalizeFn,
    private readonly isProtected: IsProtectedFn,
  ) {}

  pushChunk(chunk: string): void {
    this.lineBuffer += chunk;
    let newlineIndex = this.lineBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.pushLine(line);
      newlineIndex = this.lineBuffer.indexOf("\n");
    }
  }

  pushLine(line: string): void {
    if (this.failed) {
      return;
    }

    this.lineNumber++;

    if (line === "") {
      return;
    }

    if (line.startsWith("diff --git")) {
      if (this.currentBlock) {
        this.finalizeBlock();
        if (this.failed) {
          return;
        }
      }
      this.startBlock(line);
      return;
    }

    if (!this.currentBlock) {
      return;
    }

    this.consumeBlockLine(line);
  }

  finish(): DiffFilterResult {
    if (this.lineBuffer.length > 0) {
      this.pushLine(this.lineBuffer);
      this.lineBuffer = "";
    }

    if (!this.failed && this.currentBlock) {
      this.finalizeBlock();
    }

    if (this.failed) {
      return {
        files: [],
        omitted: [],
        failed: true,
        failureReason: this.failureReason,
      };
    }

    return { files: this.files, omitted: this.omitted, failed: false };
  }

  private startBlock(headerLine: string): void {
    const headerMatch = DIFF_HEADER_RE.exec(headerLine);
    if (!headerMatch) {
      this.failClosed(`malformed diff header at line ${this.lineNumber}`);
      return;
    }

    this.currentBlock = {
      rawPathA: headerMatch[1]!,
      rawPathB: headerMatch[2]!,
      isBinary: false,
      patchLines: [],
    };
  }

  private consumeBlockLine(line: string): void {
    const block = this.currentBlock;
    if (!block) {
      return;
    }

    const renameFromMatch = RENAME_FROM_RE.exec(line);
    if (renameFromMatch) {
      block.renameFrom = renameFromMatch[1];
      return;
    }

    const renameToMatch = RENAME_TO_RE.exec(line);
    if (renameToMatch) {
      block.renameTo = renameToMatch[1];
      return;
    }

    const copyFromMatch = COPY_FROM_RE.exec(line);
    if (copyFromMatch) {
      block.renameFrom = copyFromMatch[1];
      return;
    }

    const copyToMatch = COPY_TO_RE.exec(line);
    if (copyToMatch) {
      block.renameTo = copyToMatch[1];
      return;
    }

    if (BINARY_RE.test(line)) {
      block.isBinary = true;
      return;
    }

    if (META_RE.test(line) || FILE_HEADER_RE.test(line)) {
      return;
    }

    if (
      HUNK_RE.test(line) ||
      block.patchLines.length > 0 ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ")
    ) {
      block.patchLines.push(line);
    }
  }

  private finalizeBlock(): void {
    const block = this.currentBlock;
    if (!block) {
      return;
    }

    const effectiveOldPath = block.renameFrom ?? block.rawPathA;
    const effectiveNewPath = block.renameTo ?? block.rawPathB;
    const canonicalOld = this.canonicalize(effectiveOldPath);
    const canonicalNew = this.canonicalize(effectiveNewPath);

    if (canonicalOld === null || canonicalNew === null) {
      this.failClosed(
        `unsafe or non-canonical path "${canonicalOld === null ? effectiveOldPath : effectiveNewPath}"`,
      );
      this.currentBlock = null;
      return;
    }

    const isRename = block.renameFrom !== undefined && block.renameTo !== undefined;
    const oldProtected = this.isProtected(canonicalOld);
    const newProtected = this.isProtected(canonicalNew);

    if ((isRename && (oldProtected || newProtected)) || newProtected) {
      this.omitted.push({
        path: canonicalNew,
        oldPath: isRename ? canonicalOld : undefined,
        reason: "protected_path_content",
      });
      this.currentBlock = null;
      return;
    }

    this.files.push({
      path: canonicalNew,
      patch: block.isBinary ? "" : block.patchLines.join("\n"),
    });
    this.currentBlock = null;
  }

  private failClosed(reason: string): void {
    this.failed = true;
    this.failureReason = `diff_filter_failed: ${reason}`;
    this.currentBlock = null;
  }
}
