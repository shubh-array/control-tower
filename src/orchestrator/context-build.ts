import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  SAFETY_CONTRACT_HASH,
  SAFETY_CONTRACT_TEXT,
  OUTPUT_CONTRACT_HASH,
  OUTPUT_CONTRACT_TEXT,
} from "../app-safety/contracts.js";
import {
  buildHarnessManifest,
  type HarnessManifest,
} from "../context/harness-manifest.js";
import {
  buildRemoteOnlyCoverage,
  buildRegisteredSourceCoverage,
  hashCoverage,
  type CoverageObject,
  type DiffFilterOutcome,
} from "../context/coverage.js";
import {
  buildContextRefs,
  computeRunDirectoryLayout,
  type RunDirectoryLayout,
} from "../context/prepare.js";
import type { ProvenanceRecord } from "../context/provenance.js";
import {
  createCommitRecord,
  createCheckRecord,
  createCommentRecord,
  createDiffHunkRecord,
} from "../context/provenance.js";
import { fetchAndFilterPrDiff, type ParsedDiffHunk } from "../github/fetch-pr-diff.js";
import { computeRunInputHash } from "./run-identity.js";
import { sha256Hex } from "../util/hash.js";

export interface ProvenanceLoadDeps {
  queryPrChecks: (repositoryKey: string, prNumber: number) => Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    details_url: string | null;
  }>;
  queryPrComments: (repositoryKey: string, prNumber: number) => Array<{
    id: number;
    author_login: string;
    body: string;
    created_at: string;
    url: string | null;
  }>;
  queryPrFetchedAt: (repositoryKey: string, prNumber: number) => string | null;
}

export interface ContextBuildInput {
  appRoot: string;
  dataDirectory: string;
  profileDirectory?: string;
  jobId: string;
  runId: string;
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  sourceMode: "registered-source" | "remote-evidence-only";
  policyHash: string;
  modelSpecHash: string;
  protectedPaths?: string[];
  execGhText?: (args: string[], opts: { host: string }) => Promise<string>;
  githubHost?: string;
  ownerRepo?: string;
  baseSha?: string;
  provenanceDeps?: ProvenanceLoadDeps;
  diffHunks?: ParsedDiffHunk[];
}

export interface ContextBuildResult {
  runDir: string;
  layout: RunDirectoryLayout;
  manifest: HarnessManifest;
  coverage: CoverageObject;
  runInputHash: string;
  provenanceCatalog: ProvenanceRecord[];
  provenanceCatalogHash: string;
  artifactSetHash: string;
  sourceHash: string;
}

export interface DiffMaterializeResult {
  outcome: DiffFilterOutcome;
  omittedPaths: string[];
  diffHash: string;
  hunks: ParsedDiffHunk[];
}

export interface CoverageFinalization {
  diffFilterOutcome: DiffFilterOutcome;
  diffOmittedPaths: Array<{ path: string; reason: string }>;
  sourceTreeInspected: boolean;
  sourceOmittedPaths: Array<{ path: string; reason: string }>;
  sourceOmittedEntries: Array<{ path: string; reason: string }>;
}

function readArtifact(path: string): { content: string; hash: string; bytes: number } | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  return {
    content,
    hash: sha256Hex(content),
    bytes: Buffer.byteLength(content, "utf-8"),
  };
}

function writeCreateOnceSync(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const fd = openSync(filePath, "wx");
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function buildPrMetadata(input: ContextBuildInput): {
  content: string;
  hash: string;
  bytes: number;
} {
  const content = JSON.stringify({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    baseSha: input.baseSha ?? null,
    repository: input.ownerRepo ?? null,
    sourceMode: input.sourceMode,
  });
  return {
    content,
    hash: sha256Hex(content),
    bytes: Buffer.byteLength(content, "utf-8"),
  };
}

function buildHarnessManifestForJob(input: ContextBuildInput): HarnessManifest {
  const safetyContract = {
    content: SAFETY_CONTRACT_TEXT,
    hash: SAFETY_CONTRACT_HASH,
    bytes: Buffer.byteLength(SAFETY_CONTRACT_TEXT, "utf-8"),
  };
  const outputContract = {
    content: OUTPUT_CONTRACT_TEXT,
    hash: OUTPUT_CONTRACT_HASH,
    bytes: Buffer.byteLength(OUTPUT_CONTRACT_TEXT, "utf-8"),
  };
  const policyContent = JSON.stringify({ policyHash: input.policyHash });
  const policySnapshot = {
    content: policyContent,
    hash: sha256Hex(policyContent),
    bytes: Buffer.byteLength(policyContent, "utf-8"),
  };

  const orgPrompt = readArtifact(
    join(input.appRoot, "config/harnesses/pr-review/prompt.md"),
  );
  const orgSkill = readArtifact(
    join(
      input.appRoot,
      "config/harnesses/pr-review/skills/control-tower-pr-review/SKILL.md",
    ),
  );

  const profileDir = input.profileDirectory;
  const engineerPrompt = profileDir
    ? readArtifact(join(profileDir, "harnesses/pr-review/prompt.md"))
    : null;
  const engineerSkill = profileDir
    ? readArtifact(
        join(profileDir, "harnesses/pr-review/skills/skill/SKILL.md"),
      )
    : null;
  const persona = profileDir
    ? readArtifact(join(profileDir, "persona.md"))
    : null;

  const orgDomainGuidance: Array<{
    domain: string;
    content: string;
    hash: string;
    bytes: number;
  }> = [];
  const domainsDir = join(input.appRoot, "config/harnesses/pr-review/domains");
  if (existsSync(domainsDir)) {
    for (const file of readdirSync(domainsDir)) {
      if (!file.endsWith(".md")) continue;
      const artifact = readArtifact(join(domainsDir, file));
      if (artifact) {
        orgDomainGuidance.push({
          domain: file.replace(/\.md$/, ""),
          ...artifact,
        });
      }
    }
  }

  const prMetadata = buildPrMetadata(input);

  return buildHarnessManifest({
    safetyContract,
    outputContract,
    policySnapshot,
    orgFeaturePrompt: orgPrompt,
    orgFeatureSkill: orgSkill,
    orgDomainGuidance,
    repositoryGuidance: null,
    engineerFeaturePrompt: engineerPrompt,
    engineerFeatureSkill: engineerSkill,
    engineerDomainGuidance: [],
    persona,
    prInputs: [
      {
        logicalPath: "github/pr-metadata.json",
        hash: prMetadata.hash,
        bytes: prMetadata.bytes,
      },
    ],
    provenanceCatalog: null,
  });
}

export function buildFullProvenanceCatalog(
  input: ContextBuildInput,
  deps: ProvenanceLoadDeps | null,
): ProvenanceRecord[] {
  const catalog: ProvenanceRecord[] = [
    createCommitRecord({
      repositoryId: input.repositoryKey,
      commitSha: input.headSha,
    }),
  ];

  if (input.baseSha && input.diffHunks?.length) {
    for (const hunk of input.diffHunks) {
      catalog.push(
        createDiffHunkRecord({
          repositoryId: input.repositoryKey,
          baseSha: input.baseSha,
          headSha: input.headSha,
          canonicalPath: hunk.canonicalPath,
          hunkHash: hunk.hunkHash,
          leftRange: hunk.leftRange,
          rightRange: hunk.rightRange,
        }),
      );
    }
  }

  if (!deps) return catalog;

  const fetchedAt = deps.queryPrFetchedAt(input.repositoryKey, input.prNumber)
    ?? new Date().toISOString();

  const checks = deps.queryPrChecks(input.repositoryKey, input.prNumber);
  for (const check of checks) {
    catalog.push(
      createCheckRecord({
        checkRunId: check.id,
        attempt: 1,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        url: check.details_url ?? '',
        observedAt: fetchedAt,
      }),
    );
  }

  const comments = deps.queryPrComments(input.repositoryKey, input.prNumber);
  for (const comment of comments) {
    const bodyHash = sha256Hex(comment.body);
    catalog.push(
      createCommentRecord({
        nodeId: comment.url ?? `comment:${comment.id}`,
        databaseId: comment.id,
        authorLogin: comment.author_login,
        bodyHash,
        commitAssociation: null,
        createdAt: comment.created_at,
        updatedAt: comment.created_at,
      }),
    );
  }

  return catalog;
}

export async function materializeDiffArtifact(
  input: ContextBuildInput,
  layout: RunDirectoryLayout,
): Promise<DiffMaterializeResult> {
  if (!input.execGhText || !input.ownerRepo || !input.githubHost) {
    return { outcome: 'not_run', omittedPaths: [], diffHash: '', hunks: [] };
  }

  const result = await fetchAndFilterPrDiff(
    {
      execGhText: input.execGhText,
      host: input.githubHost,
      protectedPathPatterns: input.protectedPaths ?? [],
    },
    input.ownerRepo,
    input.prNumber,
  );

  if (result.outcome === 'succeeded' && result.filtered) {
    writeCreateOnceSync(
      join(layout.githubDir, 'pr-diff.patch'),
      result.filtered,
    );
  }

  return {
    outcome: result.outcome,
    omittedPaths: result.omittedPaths,
    diffHash: result.filtered ? sha256Hex(result.filtered) : '',
    hunks: result.hunks,
  };
}

export function finalizeCoverage(
  sourceMode: 'registered-source' | 'remote-evidence-only',
  finalization: CoverageFinalization,
): CoverageObject {
  const allOmitted = [
    ...finalization.diffOmittedPaths,
    ...finalization.sourceOmittedPaths,
  ];

  if (sourceMode === 'remote-evidence-only') {
    return buildRemoteOnlyCoverage(allOmitted, finalization.diffFilterOutcome);
  }

  return buildRegisteredSourceCoverage(
    allOmitted,
    finalization.sourceOmittedEntries,
    finalization.diffFilterOutcome,
    finalization.sourceTreeInspected,
  );
}

export function materializeFinalCoverage(
  layout: RunDirectoryLayout,
  coverage: CoverageObject,
  runInputComponents: {
    harnessManifestHash: string;
    artifactSetHash: string;
    provenanceCatalogHash: string;
    modelSpecificationHash: string;
  },
  runMeta: { runId: string; jobId: string; modelSpecHash: string },
  manifest: HarnessManifest,
  provenanceCatalog: ProvenanceRecord[],
): { runInputHash: string } {
  const sourceHash = hashCoverage(coverage);
  const runInputHash = computeRunInputHash({
    ...runInputComponents,
    sourceHash,
  });

  const coveragePath = join(layout.sourceDir, 'coverage.json');
  mkdirSync(dirname(coveragePath), { recursive: true });
  writeFileSync(coveragePath, JSON.stringify(coverage, null, 2));

  const contextRefs = buildContextRefs(
    manifest,
    coverage,
    provenanceCatalog,
    [],
  );
  writeFileSync(layout.contextRefsPath, JSON.stringify(contextRefs, null, 2));

  writeFileSync(
    layout.runJsonPath,
    JSON.stringify(
      {
        runId: runMeta.runId,
        jobId: runMeta.jobId,
        runInputHash,
        harnessManifestHash: runInputComponents.harnessManifestHash,
        artifactSetHash: runInputComponents.artifactSetHash,
        sourceHash,
        provenanceCatalogHash: runInputComponents.provenanceCatalogHash,
        modelSpecificationHash: runInputComponents.modelSpecificationHash,
      },
      null,
      2,
    ),
  );

  return { runInputHash };
}

export function computeRunContext(input: ContextBuildInput): ContextBuildResult {
  const layout = computeRunDirectoryLayout(
    input.dataDirectory,
    input.jobId,
    input.runId,
  );
  const manifest = buildHarnessManifestForJob(input);
  const omittedProtected: Array<{ path: string; reason: string }> = [];
  const coverage =
    input.sourceMode === "remote-evidence-only"
      ? buildRemoteOnlyCoverage(omittedProtected, 'not_run')
      : buildRegisteredSourceCoverage(omittedProtected, [], 'not_run', false);

  const prMetadata = buildPrMetadata(input);
  const provenanceCatalog = buildFullProvenanceCatalog(input, input.provenanceDeps ?? null);
  const provenanceCatalogHash = sha256Hex(
    provenanceCatalog
      .map((record) => record.id)
      .sort()
      .join("\n"),
  );
  const artifactSetHash = prMetadata.hash;
  const sourceHash = hashCoverage(coverage);
  const runInputHash = computeRunInputHash({
    harnessManifestHash: manifest.manifestHash,
    artifactSetHash,
    sourceHash,
    provenanceCatalogHash,
    modelSpecificationHash: input.modelSpecHash,
  });

  return {
    runDir: layout.runDir,
    layout,
    manifest,
    coverage,
    runInputHash,
    provenanceCatalog,
    provenanceCatalogHash,
    artifactSetHash,
    sourceHash,
  };
}

export function materializeRunContext(
  input: ContextBuildInput,
  built: ContextBuildResult,
): void {
  const prMetadata = buildPrMetadata(input);

  writeCreateOnceSync(
    built.layout.harnessManifestPath,
    JSON.stringify(built.manifest, null, 2),
  );
  writeCreateOnceSync(
    join(built.layout.githubDir, "pr-metadata.json"),
    prMetadata.content,
  );
  writeCreateOnceSync(
    join(built.layout.githubDir, "provenance-catalog.json"),
    JSON.stringify(built.provenanceCatalog, null, 2),
  );
}
