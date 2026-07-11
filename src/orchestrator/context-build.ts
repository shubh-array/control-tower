import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
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
} from "../context/coverage.js";
import {
  buildContextRefs,
  computeRunDirectoryLayout,
  type RunDirectoryLayout,
} from "../context/prepare.js";
import type { ProvenanceRecord } from "../context/provenance.js";
import { createCommitRecord } from "../context/provenance.js";
import { computeRunInputHash } from "./run-identity.js";
import { sha256Hex } from "../util/hash.js";

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
    role: "primaryReview",
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
      ? buildRemoteOnlyCoverage(omittedProtected, false)
      : buildRegisteredSourceCoverage(omittedProtected, [], false);

  const prMetadata = buildPrMetadata(input);
  const provenanceCatalog: ProvenanceRecord[] = [
    createCommitRecord({
      repositoryId: input.repositoryKey,
      commitSha: input.headSha,
    }),
  ];
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
  const contextRefs = buildContextRefs(
    built.manifest,
    built.coverage,
    built.provenanceCatalog,
    [],
  );

  writeCreateOnceSync(
    built.layout.harnessManifestPath,
    JSON.stringify(built.manifest, null, 2),
  );
  writeCreateOnceSync(
    join(built.layout.sourceDir, "coverage.json"),
    JSON.stringify(built.coverage, null, 2),
  );
  writeCreateOnceSync(
    join(built.layout.githubDir, "pr-metadata.json"),
    prMetadata.content,
  );
  writeCreateOnceSync(
    join(built.layout.githubDir, "provenance-catalog.json"),
    JSON.stringify(built.provenanceCatalog, null, 2),
  );
  writeCreateOnceSync(
    built.layout.contextRefsPath,
    JSON.stringify(contextRefs, null, 2),
  );
  writeCreateOnceSync(
    built.layout.runJsonPath,
    JSON.stringify(
      {
        runId: input.runId,
        jobId: input.jobId,
        attemptNumber: null,
        runInputHash: built.runInputHash,
        harnessManifestHash: built.manifest.manifestHash,
        artifactSetHash: built.artifactSetHash,
        sourceHash: built.sourceHash,
        provenanceCatalogHash: built.provenanceCatalogHash,
        modelSpecificationHash: input.modelSpecHash,
      },
      null,
      2,
    ),
  );
}
