import type {
  DiffFilterResult,
  FilteredDiffFile,
  OmittedDiffFile,
} from "./types.js";

type CanonicalizeFn = (rawPath: string) => string | null;
type IsProtectedFn = (canonicalPath: string) => boolean;

const DIFF_BLOCK_RE = /^diff --git /;
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

  const lines = diffText.split("\n");
  const files: FilteredDiffFile[] = [];
  const omitted: OmittedDiffFile[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line === "") {
      index++;
      continue;
    }

    if (!line.startsWith("diff --git")) {
      index++;
      continue;
    }

    const headerMatch = DIFF_HEADER_RE.exec(line);
    if (!headerMatch) {
      return failClosed(`malformed diff header at line ${index + 1}`);
    }

    const rawPathA = headerMatch[1]!;
    const rawPathB = headerMatch[2]!;
    index++;

    let renameFrom: string | undefined;
    let renameTo: string | undefined;
    let isBinary = false;
    const patchLines: string[] = [];

    while (index < lines.length && !DIFF_BLOCK_RE.test(lines[index] ?? "")) {
      const nextLine = lines[index] ?? "";

      const renameFromMatch = RENAME_FROM_RE.exec(nextLine);
      if (renameFromMatch) {
        renameFrom = renameFromMatch[1];
        index++;
        continue;
      }

      const renameToMatch = RENAME_TO_RE.exec(nextLine);
      if (renameToMatch) {
        renameTo = renameToMatch[1];
        index++;
        continue;
      }

      const copyFromMatch = COPY_FROM_RE.exec(nextLine);
      if (copyFromMatch) {
        renameFrom = copyFromMatch[1];
        index++;
        continue;
      }

      const copyToMatch = COPY_TO_RE.exec(nextLine);
      if (copyToMatch) {
        renameTo = copyToMatch[1];
        index++;
        continue;
      }

      if (BINARY_RE.test(nextLine)) {
        isBinary = true;
        index++;
        continue;
      }

      if (META_RE.test(nextLine) || FILE_HEADER_RE.test(nextLine)) {
        index++;
        continue;
      }

      if (
        HUNK_RE.test(nextLine) ||
        patchLines.length > 0 ||
        nextLine.startsWith("+") ||
        nextLine.startsWith("-") ||
        nextLine.startsWith(" ")
      ) {
        patchLines.push(nextLine);
      }

      index++;
    }

    const effectiveOldPath = renameFrom ?? rawPathA;
    const effectiveNewPath = renameTo ?? rawPathB;
    const canonicalOld = canonicalize(effectiveOldPath);
    const canonicalNew = canonicalize(effectiveNewPath);

    if (canonicalOld === null || canonicalNew === null) {
      return failClosed(
        `unsafe or non-canonical path "${canonicalOld === null ? effectiveOldPath : effectiveNewPath}"`,
      );
    }

    const isRename = renameFrom !== undefined && renameTo !== undefined;
    const oldProtected = isProtected(canonicalOld);
    const newProtected = isProtected(canonicalNew);

    if ((isRename && (oldProtected || newProtected)) || newProtected) {
      omitted.push({
        path: canonicalNew,
        oldPath: isRename ? canonicalOld : undefined,
        reason: "protected_path_content",
      });
      continue;
    }

    files.push({
      path: canonicalNew,
      patch: isBinary ? "" : patchLines.join("\n"),
    });
  }

  return { files, omitted, failed: false };
}

function failClosed(reason: string): DiffFilterResult {
  return {
    files: [],
    omitted: [],
    failed: true,
    failureReason: `diff_filter_failed: ${reason}`,
  };
}
