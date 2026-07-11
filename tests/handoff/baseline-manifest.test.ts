import { describe, it, expect } from 'vitest';
import {
  generateBaselineManifest,
  PHASE_1_MANIFEST_SCHEMA_VERSION,
} from '../../src/handoff/baseline-manifest';

describe('Phase 1 Baseline Manifest', () => {
  it('generates a sealed manifest with contract and implementation hashes', () => {
    const manifest = generateBaselineManifest({
      contractHash: 'contract_aabbccdd',
      implementationHash: 'impl_11223344',
      schemasHash: 'schemas_55667788',
      migrationsHash: 'migrations_99aabb',
      safetyContractHash: 'safety_ccddee',
      provenanceContractHash: 'provenance_ffeedd',
      modelRoleContractHash: 'model_role_112233',
      harnessContractHash: 'harness_445566',
      corpusHashes: {
        attention: 'corpus_attn_aabb',
        primaryReview: 'corpus_review_ccdd',
      },
      corpusResultsHashes: {
        attention: 'results_attn_eeff',
        primaryReview: 'results_review_1122',
      },
      metricDefinitionHash: 'metrics_def_3344',
      metricSchemaHash: 'metrics_schema_5566',
    });

    expect(manifest.schemaVersion).toBe(PHASE_1_MANIFEST_SCHEMA_VERSION);
    expect(manifest.sealed).toBe(true);
    expect(manifest.canonicalHash).toBeDefined();
    expect(manifest.canonicalHash.startsWith('')).toBe(true);
  });

  it('excludes Phase 2 identity and evaluation fields', () => {
    const manifest = generateBaselineManifest({
      contractHash: 'c1',
      implementationHash: 'i1',
      schemasHash: 's1',
      migrationsHash: 'm1',
      safetyContractHash: 'safe1',
      provenanceContractHash: 'prov1',
      modelRoleContractHash: 'mr1',
      harnessContractHash: 'h1',
      corpusHashes: { attention: 'ca1', primaryReview: 'cr1' },
      corpusResultsHashes: { attention: 'ra1', primaryReview: 'rr1' },
      metricDefinitionHash: 'md1',
      metricSchemaHash: 'ms1',
    });

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('phase2');
    expect(serialized).not.toContain('Phase2');
    expect(serialized).not.toContain('linearIntegration');
    expect(serialized).not.toContain('specialistAgent');
    expect(serialized).not.toContain('deliveryIntelligence');
  });

  it('produces identical canonical hash for identical inputs', () => {
    const inputs = {
      contractHash: 'c1',
      implementationHash: 'i1',
      schemasHash: 's1',
      migrationsHash: 'm1',
      safetyContractHash: 'safe1',
      provenanceContractHash: 'prov1',
      modelRoleContractHash: 'mr1',
      harnessContractHash: 'h1',
      corpusHashes: { attention: 'ca1', primaryReview: 'cr1' },
      corpusResultsHashes: { attention: 'ra1', primaryReview: 'rr1' },
      metricDefinitionHash: 'md1',
      metricSchemaHash: 'ms1',
    };
    const m1 = generateBaselineManifest(inputs);
    const m2 = generateBaselineManifest(inputs);
    expect(m1.canonicalHash).toBe(m2.canonicalHash);
  });

  it('produces different hash for different inputs', () => {
    const base = {
      contractHash: 'c1',
      implementationHash: 'i1',
      schemasHash: 's1',
      migrationsHash: 'm1',
      safetyContractHash: 'safe1',
      provenanceContractHash: 'prov1',
      modelRoleContractHash: 'mr1',
      harnessContractHash: 'h1',
      corpusHashes: { attention: 'ca1', primaryReview: 'cr1' },
      corpusResultsHashes: { attention: 'ra1', primaryReview: 'rr1' },
      metricDefinitionHash: 'md1',
      metricSchemaHash: 'ms1',
    };
    const m1 = generateBaselineManifest(base);
    const m2 = generateBaselineManifest({ ...base, implementationHash: 'i2' });
    expect(m1.canonicalHash).not.toBe(m2.canonicalHash);
  });

  it('contains only Phase 1 hashes as declared baseline reference', () => {
    const manifest = generateBaselineManifest({
      contractHash: 'c1',
      implementationHash: 'i1',
      schemasHash: 's1',
      migrationsHash: 'm1',
      safetyContractHash: 'safe1',
      provenanceContractHash: 'prov1',
      modelRoleContractHash: 'mr1',
      harnessContractHash: 'h1',
      corpusHashes: { attention: 'ca1', primaryReview: 'cr1' },
      corpusResultsHashes: { attention: 'ra1', primaryReview: 'rr1' },
      metricDefinitionHash: 'md1',
      metricSchemaHash: 'ms1',
    });

    expect(manifest.phase1Contract.contractHash).toBe('c1');
    expect(manifest.phase1Contract.implementationHash).toBe('i1');
    expect(manifest.evaluation.corpusHashes.attention).toBe('ca1');
    expect(manifest.evaluation.metricDefinitionHash).toBe('md1');
  });
});
