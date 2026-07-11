export type CanonicalPathResult =
  | { valid: true; path: string }
  | { valid: false; reason: string };

interface ValidateOptions {
  stripDiffPrefix?: boolean;
}

export function validateCanonicalPath(
  raw: string,
  opts?: ValidateOptions,
): CanonicalPathResult {
  if (raw.length === 0) {
    return { valid: false, reason: "empty path" };
  }

  let p = raw;
  if (opts?.stripDiffPrefix) {
    const m = /^[ab]\/(.+)$/.exec(p);
    if (m) p = m[1]!;
  }

  if (p.startsWith("/")) {
    return { valid: false, reason: "absolute path" };
  }

  if (p.endsWith("/")) {
    return { valid: false, reason: "trailing slash" };
  }

  if (p.includes("\\")) {
    return { valid: false, reason: "backslash not allowed" };
  }

  for (let i = 0; i < p.length; i++) {
    const code = p.charCodeAt(i);
    if (code === 0 || (code >= 1 && code <= 31) || code === 127) {
      return { valid: false, reason: "control character" };
    }
  }

  if (p !== p.normalize("NFC")) {
    return { valid: false, reason: "path is not NFC-normalized" };
  }

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "") {
      return { valid: false, reason: "empty segment" };
    }
    if (seg === "." || seg === "..") {
      return { valid: false, reason: "dot segment" };
    }
    if (seg.toLowerCase() === ".git") {
      return { valid: false, reason: ".git segment" };
    }
  }

  return { valid: true, path: p };
}
