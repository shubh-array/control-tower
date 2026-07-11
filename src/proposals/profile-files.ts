import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../util/hash.js";
import { isAllowedTarget } from "./types.js";
import { loadCorpus, loadCase } from "../../eval/runner.js";
import type { CorpusCase } from "./replay.js";

export function loadProfileFiles(
  profileDir: string,
): Record<string, { content: string; hash: string }> {
  const files: Record<string, { content: string; hash: string }> = {};

  function walk(dir: string, prefix: string): void {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else if (isAllowedTarget(rel)) {
        const content = readFileSync(full, "utf-8");
        files[rel] = { content, hash: sha256Hex(content) };
      }
    }
  }

  for (const top of ["policy.json", "persona.md"]) {
    const full = join(profileDir, top);
    if (existsSync(full)) {
      const content = readFileSync(full, "utf-8");
      files[top] = { content, hash: sha256Hex(content) };
    }
  }

  walk(join(profileDir, "harnesses"), "harnesses");
  return files;
}

export function loadCorpusCases(
  appRoot: string,
  role: "attention" | "primaryReview",
): CorpusCase[] {
  const corpusPath = join(appRoot, "eval", role === "attention" ? "attention" : "primary-review", "corpus.json");
  const corpus = loadCorpus(corpusPath);
  const basePath = join(corpusPath, "..");
  return corpus.cases.map((casePath) => {
    const caseData = loadCase(basePath, casePath) as {
      caseId: string;
      input: unknown;
      expected: unknown;
    };
    return {
      caseId: caseData.caseId,
      input: caseData.input,
      expected: caseData.expected,
    };
  });
}

export function defaultProposalEvaluator(): (
  output: unknown,
  expected: unknown,
) => { passed: boolean; metricValues: Record<string, number> } {
  return () => ({ passed: true, metricValues: {} });
}
