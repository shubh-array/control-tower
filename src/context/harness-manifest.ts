import { createHash } from 'node:crypto';

export interface ArtifactRef {
  content: string;
  hash: string;
  bytes: number;
}

export interface DomainArtifact {
  domain: string;
  content: string;
  hash: string;
  bytes: number;
}

export interface InputArtifact {
  logicalPath: string;
  hash: string;
  bytes: number;
}

export interface ManifestBuildInput {
  role: 'primaryReview' | 'attention';
  safetyContract: ArtifactRef;
  outputContract: ArtifactRef;
  policySnapshot: ArtifactRef;
  orgFeaturePrompt: ArtifactRef | null;
  orgFeatureSkill: ArtifactRef | null;
  orgDomainGuidance: DomainArtifact[];
  repositoryGuidance: ArtifactRef | null;
  engineerFeaturePrompt: ArtifactRef | null;
  engineerFeatureSkill: ArtifactRef | null;
  engineerDomainGuidance: DomainArtifact[];
  persona: ArtifactRef | null;
  prInputs: InputArtifact[];
  provenanceCatalog: InputArtifact | null;
}

export interface ManifestEntry {
  layerOrdinal: number;
  layerName: string;
  entryOrdinal: number;
  feature: string;
  domain: string | null;
  logicalPath: string;
  contentHash: string;
  byteLength: number;
}

export interface HarnessManifest {
  entries: ManifestEntry[];
  manifestHash: string;
}

export function buildHarnessManifest(input: ManifestBuildInput): HarnessManifest {
  const entries: ManifestEntry[] = [];
  let ordinal = 0;

  function add(layer: number, layerName: string, logicalPath: string, hash: string, bytes: number, feature: string, domain: string | null) {
    entries.push({
      layerOrdinal: layer,
      layerName,
      entryOrdinal: ordinal++,
      feature,
      domain,
      logicalPath,
      contentHash: hash,
      byteLength: bytes,
    });
  }

  const feature = input.role === 'primaryReview' ? 'pr-review' : 'pr-attention';

  add(1, 'application_safety', 'safety-contract.md', input.safetyContract.hash, input.safetyContract.bytes, feature, null);
  add(1, 'application_safety', 'output-contract.md', input.outputContract.hash, input.outputContract.bytes, feature, null);

  add(2, 'policy_snapshot', 'policy.snapshot.json', input.policySnapshot.hash, input.policySnapshot.bytes, feature, null);

  if (input.orgFeaturePrompt) {
    add(3, 'org_feature_guidance', `harnesses/${feature}/prompt.md`, input.orgFeaturePrompt.hash, input.orgFeaturePrompt.bytes, feature, null);
  }
  if (input.orgFeatureSkill) {
    add(3, 'org_feature_guidance', `harnesses/${feature}/skills/skill/SKILL.md`, input.orgFeatureSkill.hash, input.orgFeatureSkill.bytes, feature, null);
  }

  if (input.role === 'primaryReview') {
    for (const dg of input.orgDomainGuidance) {
      add(4, 'org_domain_guidance', `harnesses/pr-review/domains/${dg.domain}.md`, dg.hash, dg.bytes, feature, dg.domain);
    }
  }

  if (input.role === 'primaryReview' && input.repositoryGuidance) {
    add(5, 'repository_guidance', 'repository-guidance.md', input.repositoryGuidance.hash, input.repositoryGuidance.bytes, feature, null);
  }

  if (input.engineerFeaturePrompt) {
    add(6, 'engineer_feature_guidance', `profile/harnesses/${feature}/prompt.md`, input.engineerFeaturePrompt.hash, input.engineerFeaturePrompt.bytes, feature, null);
  }
  if (input.engineerFeatureSkill) {
    add(6, 'engineer_feature_guidance', `profile/harnesses/${feature}/skills/skill/SKILL.md`, input.engineerFeatureSkill.hash, input.engineerFeatureSkill.bytes, feature, null);
  }

  if (input.role === 'primaryReview') {
    for (const dg of input.engineerDomainGuidance) {
      add(7, 'engineer_domain_guidance', `profile/harnesses/pr-review/domains/${dg.domain}.md`, dg.hash, dg.bytes, feature, dg.domain);
    }
  }

  if (input.persona) {
    add(8, 'persona', 'persona.md', input.persona.hash, input.persona.bytes, feature, null);
  }

  for (const prInput of input.prInputs) {
    add(9, 'pr_inputs', prInput.logicalPath, prInput.hash, prInput.bytes, feature, null);
  }
  if (input.role === 'primaryReview' && input.provenanceCatalog) {
    add(9, 'pr_inputs', input.provenanceCatalog.logicalPath, input.provenanceCatalog.hash, input.provenanceCatalog.bytes, feature, null);
  }

  const manifestHash = computeManifestHash(entries);
  return { entries, manifestHash };
}

function computeManifestHash(entries: ManifestEntry[]): string {
  const canonical = JSON.stringify(
    entries.map(e => ({
      byteLength: e.byteLength,
      contentHash: e.contentHash,
      domain: e.domain,
      entryOrdinal: e.entryOrdinal,
      feature: e.feature,
      layerName: e.layerName,
      layerOrdinal: e.layerOrdinal,
      logicalPath: e.logicalPath,
    })),
  );
  return createHash('sha256').update(canonical).digest('hex');
}
