export type GlobValidationResult =
  | { valid: true; pattern: string; segments: GlobSegment[] }
  | { valid: false; reason: string };

export type GlobSegment =
  | { type: "literal"; value: string }
  | { type: "wildcard"; value: string }
  | { type: "globstar" };

export function validateGlob(raw: string): GlobValidationResult {
  if (raw.length === 0) {
    return { valid: false, reason: "empty pattern" };
  }
  if (raw.startsWith("/") || raw.endsWith("/")) {
    return { valid: false, reason: "leading or trailing slash" };
  }
  if (raw.includes("\\")) {
    return { valid: false, reason: "backslash not allowed" };
  }

  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0 || (code >= 1 && code <= 31) || code === 127) {
      return { valid: false, reason: "control character" };
    }
  }

  if (raw !== raw.normalize("NFC")) {
    return { valid: false, reason: "pattern is not NFC-normalized" };
  }

  if (raw.includes("***")) {
    return { valid: false, reason: "*** is not supported" };
  }

  if (/[[\]{}()!@+]/.test(raw)) {
    return { valid: false, reason: "character classes, braces, and extglob not supported" };
  }

  const parts = raw.split("/");
  const segments: GlobSegment[] = [];

  for (const part of parts) {
    if (part === "") {
      return { valid: false, reason: "empty segment" };
    }
    if (part === "." || part === "..") {
      return { valid: false, reason: "dot segment" };
    }

    if (part === "**") {
      segments.push({ type: "globstar" });
    } else if (part.includes("**")) {
      return { valid: false, reason: "** must be an entire segment" };
    } else if (part.includes("*") || part.includes("?")) {
      segments.push({ type: "wildcard", value: part });
    } else {
      segments.push({ type: "literal", value: part });
    }
  }

  return { valid: true, pattern: raw, segments };
}

export function deduplicateGlobs(
  patterns: readonly string[],
): { unique: string[]; duplicates: string[] } {
  const seen = new Set<string>();
  const unique: string[] = [];
  const duplicates: string[] = [];
  for (const p of patterns) {
    if (seen.has(p)) {
      duplicates.push(p);
    } else {
      seen.add(p);
      unique.push(p);
    }
  }
  return { unique, duplicates };
}
