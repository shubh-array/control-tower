import type { CanonicalPathMatcher } from "../paths/matcher.js";

export interface NormalizedFile {
  canonicalPath: string;
  isUnsafe: false;
}

export interface UnsafeFile {
  raw: string;
  diagnostic: string;
  isUnsafe: true;
}

export type FileNormResult = NormalizedFile | UnsafeFile;

export function normalizeFilePath(
  rawPath: string,
  matcher: CanonicalPathMatcher,
): FileNormResult {
  const canonical = matcher.canonicalize(rawPath);
  if (canonical === null) {
    return {
      raw: rawPath.slice(0, 500),
      diagnostic: `Unsafe or non-canonical path rejected: "${rawPath.slice(0, 200)}"`,
      isUnsafe: true,
    };
  }

  return {
    canonicalPath: canonical,
    isUnsafe: false,
  };
}

export function normalizeFileList(
  paths: string[],
  matcher: CanonicalPathMatcher,
): { canonical: string[]; unsafe: Array<{ raw: string; diagnostic: string }> } {
  const canonical: string[] = [];
  const unsafe: Array<{ raw: string; diagnostic: string }> = [];

  for (const rawPath of paths) {
    const result = normalizeFilePath(rawPath, matcher);
    if ("canonicalPath" in result) {
      canonical.push(result.canonicalPath);
    } else {
      unsafe.push({ raw: result.raw, diagnostic: result.diagnostic });
    }
  }

  return { canonical, unsafe };
}
