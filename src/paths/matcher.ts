import { validateCanonicalPath } from "./canonical-path.js";
import type { GlobSegment } from "./glob.js";
import { validateGlob } from "./glob.js";
import { sha256Hex } from "../util/hash.js";
import { canonicalJsonSerialize } from "../util/canonical-json.js";

export interface MatcherArtifact {
  readonly version: number;
  readonly contentHash: string;
  readonly patterns: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
}

export interface PatternSource {
  pattern: string;
  source: string;
}

interface CompiledPattern {
  raw: string;
  segments: GlobSegment[];
}

export class CanonicalPathMatcher {
  static readonly VERSION = 1;

  readonly version = CanonicalPathMatcher.VERSION;
  readonly contentHash: string;
  readonly patterns: readonly string[];

  private readonly compiled: readonly CompiledPattern[];
  private readonly sourceMap: ReadonlyMap<string, string>;

  private constructor(
    compiled: CompiledPattern[],
    sourceMap: Map<string, string>,
    contentHash: string,
  ) {
    this.compiled = compiled;
    this.sourceMap = sourceMap;
    this.contentHash = contentHash;
    this.patterns = compiled.map((c) => c.raw);
  }

  static compile(inputs: readonly PatternSource[]): CanonicalPathMatcher {
    const compiled: CompiledPattern[] = [];
    const sourceMap = new Map<string, string>();
    const seen = new Set<string>();

    for (const { pattern, source } of inputs) {
      const result = validateGlob(pattern);
      if (!result.valid) {
        throw new Error(`Invalid glob "${pattern}": ${result.reason}`);
      }
      if (seen.has(result.pattern)) {
        if (sourceMap.get(result.pattern) === source) {
          throw new Error(
            `Duplicate glob "${result.pattern}" within source "${source}"`,
          );
        }
        continue;
      }
      seen.add(result.pattern);
      compiled.push({ raw: result.pattern, segments: result.segments });
      sourceMap.set(result.pattern, source);
    }

    const hashInput = canonicalJsonSerialize({
      version: CanonicalPathMatcher.VERSION,
      patterns: compiled.map((c) => c.raw),
    });
    const contentHash = sha256Hex(hashInput);

    return new CanonicalPathMatcher(compiled, sourceMap, contentHash);
  }

  matches(path: string): boolean {
    const result = validateCanonicalPath(path);
    if (!result.valid) return false;
    return this.compiled.some((cp) =>
      matchSegments(result.path.split("/"), cp.segments, 0, 0),
    );
  }

  matchedPatterns(path: string): string[] {
    const result = validateCanonicalPath(path);
    if (!result.valid) return [];
    const pathSegs = result.path.split("/");
    return this.compiled
      .filter((cp) => matchSegments(pathSegs, cp.segments, 0, 0))
      .map((cp) => cp.raw);
  }

  getSource(pattern: string): string | undefined {
    return this.sourceMap.get(pattern);
  }

  toArtifact(): MatcherArtifact {
    return {
      version: this.version,
      contentHash: this.contentHash,
      patterns: this.patterns,
      sources: new Map(this.sourceMap),
    };
  }
}

function matchSegments(
  pathSegs: string[],
  patternSegs: GlobSegment[],
  pi: number,
  gi: number,
): boolean {
  while (gi < patternSegs.length && pi < pathSegs.length) {
    const seg = patternSegs[gi]!;

    if (seg.type === "globstar") {
      if (gi === patternSegs.length - 1) return true;
      for (let skip = 0; skip <= pathSegs.length - pi; skip++) {
        if (matchSegments(pathSegs, patternSegs, pi + skip, gi + 1)) {
          return true;
        }
      }
      return false;
    }

    if (seg.type === "literal") {
      if (pathSegs[pi] !== seg.value) return false;
    } else {
      if (!matchWildcardSegment(pathSegs[pi]!, seg.value)) return false;
    }

    pi++;
    gi++;
  }

  while (gi < patternSegs.length && patternSegs[gi]!.type === "globstar") {
    gi++;
  }

  return pi === pathSegs.length && gi === patternSegs.length;
}

function matchWildcardSegment(text: string, pattern: string): boolean {
  const tLen = text.length;
  const pLen = pattern.length;
  let ti = 0;
  let pi = 0;
  let starTi = -1;
  let starPi = -1;

  while (ti < tLen) {
    if (pi < pLen && pattern[pi] === "*") {
      starPi = pi;
      starTi = ti;
      pi++;
    } else if (pi < pLen && (pattern[pi] === "?" || pattern[pi] === text[ti])) {
      pi++;
      ti++;
    } else if (starPi >= 0) {
      pi = starPi + 1;
      starTi++;
      ti = starTi;
    } else {
      return false;
    }
  }

  while (pi < pLen && pattern[pi] === "*") pi++;
  return pi === pLen;
}
