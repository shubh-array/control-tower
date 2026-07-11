import { sha256Hex } from '../util/hash.js';

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
