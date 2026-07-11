import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SAFETY_CONTRACT_HASH } from '../app-safety/contracts.js';
import { sha256Hex, sha256OfCanonicalJson } from '../util/hash.js';

export const PHASE_1_MANIFEST_SCHEMA_VERSION = 1;

export interface BaselineManifestInputs {
  contractHash: string;
  implementationHash: string;
  schemasHash: string;
  migrationsHash: string;
  safetyContractHash: string;
  provenanceContractHash: string;
  modelRoleContractHash: string;
  harnessContractHash: string;
  corpusHashes: { attention: string; primaryReview: string };
  corpusResultsHashes: { attention: string; primaryReview: string };
  metricDefinitionHash: string;
  metricSchemaHash: string;
}

export interface BaselineManifest {
  schemaVersion: number;
  sealed: boolean;
  generatedAt: string;
  canonicalHash: string;
  phase1Contract: {
    contractHash: string;
    implementationHash: string;
    schemasHash: string;
    migrationsHash: string;
    safetyContractHash: string;
    provenanceContractHash: string;
    modelRoleContractHash: string;
    harnessContractHash: string;
  };
  evaluation: {
    corpusHashes: { attention: string; primaryReview: string };
    corpusResultsHashes: { attention: string; primaryReview: string };
    metricDefinitionHash: string;
    metricSchemaHash: string;
  };
}

function computeCanonicalHash(inputs: BaselineManifestInputs): string {
  const canonical = JSON.stringify({
    contract: inputs.contractHash,
    implementation: inputs.implementationHash,
    schemas: inputs.schemasHash,
    migrations: inputs.migrationsHash,
    safety: inputs.safetyContractHash,
    provenance: inputs.provenanceContractHash,
    modelRole: inputs.modelRoleContractHash,
    harness: inputs.harnessContractHash,
    corpusAttention: inputs.corpusHashes.attention,
    corpusPrimaryReview: inputs.corpusHashes.primaryReview,
    resultsAttention: inputs.corpusResultsHashes.attention,
    resultsPrimaryReview: inputs.corpusResultsHashes.primaryReview,
    metricDefinition: inputs.metricDefinitionHash,
    metricSchema: inputs.metricSchemaHash,
  });
  return sha256Hex(canonical);
}

function hashFileContent(path: string): string {
  return sha256Hex(readFileSync(path, 'utf-8'));
}

function hashSortedFiles(paths: string[]): string {
  return sha256OfCanonicalJson(
    [...paths].sort().map((path) => ({ path, hash: hashFileContent(path) })),
  );
}

function hashDirectoryTree(root: string, match: (relativePath: string) => boolean): string {
  const entries: Array<{ path: string; hash: string }> = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (match(rel)) {
        entries.push({ path: rel, hash: hashFileContent(full) });
      }
    }
  }

  walk(root);
  return sha256OfCanonicalJson(entries);
}

export function collectBaselineManifestInputs(appRoot: string): BaselineManifestInputs {
  const srcRoot = join(appRoot, 'src');
  const evalRoot = join(appRoot, 'eval');

  const attentionCorpus = join(evalRoot, 'attention/corpus.json');
  const primaryReviewCorpus = join(evalRoot, 'primary-review/corpus.json');

  return {
    contractHash: hashFileContent(join(srcRoot, 'api/contracts.ts')),
    implementationHash: hashDirectoryTree(srcRoot, (p) => p.endsWith('.ts')),
    schemasHash: hashSortedFiles([
      join(srcRoot, 'config/types.ts'),
      join(srcRoot, 'learning/signals.ts'),
    ]),
    migrationsHash: hashDirectoryTree(join(srcRoot, 'store/migrations'), (p) => p.endsWith('.sql')),
    safetyContractHash: SAFETY_CONTRACT_HASH,
    provenanceContractHash: hashFileContent(join(srcRoot, 'context/provenance.ts')),
    modelRoleContractHash: hashSortedFiles([
      join(srcRoot, 'config/types.ts'),
      join(srcRoot, 'cursor/adapter.ts'),
    ]),
    harnessContractHash: hashFileContent(join(srcRoot, 'context/harness-manifest.ts')),
    corpusHashes: {
      attention: hashFileContent(attentionCorpus),
      primaryReview: hashFileContent(primaryReviewCorpus),
    },
    corpusResultsHashes: {
      attention: hashDirectoryTree(join(evalRoot, 'attention/cases'), (p) => p.endsWith('.json')),
      primaryReview: hashDirectoryTree(join(evalRoot, 'primary-review/cases'), (p) => p.endsWith('.json')),
    },
    metricDefinitionHash: hashSortedFiles([
      join(evalRoot, 'metrics/attention.ts'),
      join(evalRoot, 'metrics/primary-review.ts'),
      join(evalRoot, 'gates.ts'),
    ]),
    metricSchemaHash: hashSortedFiles([attentionCorpus, primaryReviewCorpus]),
  };
}

export function generateBaselineManifest(inputs: BaselineManifestInputs): BaselineManifest {
  return {
    schemaVersion: PHASE_1_MANIFEST_SCHEMA_VERSION,
    sealed: true,
    generatedAt: new Date().toISOString(),
    canonicalHash: computeCanonicalHash(inputs),
    phase1Contract: {
      contractHash: inputs.contractHash,
      implementationHash: inputs.implementationHash,
      schemasHash: inputs.schemasHash,
      migrationsHash: inputs.migrationsHash,
      safetyContractHash: inputs.safetyContractHash,
      provenanceContractHash: inputs.provenanceContractHash,
      modelRoleContractHash: inputs.modelRoleContractHash,
      harnessContractHash: inputs.harnessContractHash,
    },
    evaluation: {
      corpusHashes: inputs.corpusHashes,
      corpusResultsHashes: inputs.corpusResultsHashes,
      metricDefinitionHash: inputs.metricDefinitionHash,
      metricSchemaHash: inputs.metricSchemaHash,
    },
  };
}
