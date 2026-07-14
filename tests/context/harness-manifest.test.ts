import { describe, it, expect } from 'vitest';
import {
  buildHarnessManifest,
  type ManifestBuildInput,
} from '../../src/context/harness-manifest.js';

function makeReviewInput(): ManifestBuildInput {
  return {
    safetyContract: { content: 'safety rules', hash: 'safety-hash', bytes: 12 },
    outputContract: { content: 'output schema', hash: 'output-hash', bytes: 13 },
    policySnapshot: { content: '{}', hash: 'policy-hash', bytes: 2 },
    orgFeaturePrompt: { content: 'org prompt', hash: 'org-prompt-hash', bytes: 10 },
    orgFeatureSkill: { content: 'org skill', hash: 'org-skill-hash', bytes: 9 },
    orgDomainGuidance: [
      { domain: 'backend', content: 'backend guidance', hash: 'backend-hash', bytes: 16 },
    ],
    repositoryGuidance: { content: 'repo guidance', hash: 'repo-hash', bytes: 13 },
    engineerFeaturePrompt: { content: 'eng prompt', hash: 'eng-prompt-hash', bytes: 10 },
    engineerFeatureSkill: { content: 'eng skill', hash: 'eng-skill-hash', bytes: 9 },
    engineerDomainGuidance: [
      { domain: 'backend', content: 'eng backend', hash: 'eng-backend-hash', bytes: 11 },
    ],
    persona: { content: 'persona', hash: 'persona-hash', bytes: 7 },
    prInputs: [{ logicalPath: 'pr.json', hash: 'pr-hash', bytes: 100 }],
    provenanceCatalog: { logicalPath: 'provenance-catalog.json', hash: 'prov-hash', bytes: 200 },
  };
}

describe('buildHarnessManifest', () => {
  it('assigns nine layers with correct ordinals for primary review', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layers = new Set(manifest.entries.map(e => e.layerOrdinal));
    expect(layers).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  it('layer 1 contains safety contract then output contract', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer1 = manifest.entries.filter(e => e.layerOrdinal === 1);
    expect(layer1).toHaveLength(2);
    expect(layer1[0]!.logicalPath).toContain('safety');
    expect(layer1[1]!.logicalPath).toContain('output');
    expect(layer1[0]!.entryOrdinal).toBeLessThan(layer1[1]!.entryOrdinal);
  });

  it('layer 2 contains only policy.snapshot.json', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer2 = manifest.entries.filter(e => e.layerOrdinal === 2);
    expect(layer2).toHaveLength(1);
    expect(layer2[0]!.logicalPath).toBe('policy.snapshot.json');
  });

  it('uses pr-review feature paths throughout', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    expect(manifest.entries.every((entry) => entry.feature === 'pr-review')).toBe(true);
    expect(manifest.entries.some((entry) => entry.logicalPath.includes('pr-review'))).toBe(true);
  });

  it('primary review layer 9 ends with provenance catalog', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer9 = manifest.entries.filter(e => e.layerOrdinal === 9);
    const last = layer9[layer9.length - 1]!;
    expect(last.logicalPath).toBe('provenance-catalog.json');
  });

  it('every entry has a globally unique entryOrdinal', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const ordinals = manifest.entries.map(e => e.entryOrdinal);
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it('no entry appears in more than one layer', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const pathToLayers = new Map<string, number[]>();
    for (const entry of manifest.entries) {
      const layers = pathToLayers.get(entry.logicalPath) ?? [];
      layers.push(entry.layerOrdinal);
      pathToLayers.set(entry.logicalPath, layers);
    }
    for (const [path, layers] of pathToLayers) {
      expect(layers.length, `${path} appears in multiple layers`).toBe(1);
    }
  });

  it('manifest hash changes when any entry content hash changes', () => {
    const input1 = makeReviewInput();
    const input2 = makeReviewInput();
    input2.persona = { content: 'different', hash: 'different-hash', bytes: 9 };
    const m1 = buildHarnessManifest(input1);
    const m2 = buildHarnessManifest(input2);
    expect(m1.manifestHash).not.toBe(m2.manifestHash);
  });

  it('feature prompts precede their skill within layers 3 and 6', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer3 = manifest.entries.filter(e => e.layerOrdinal === 3);
    const promptIdx = layer3.findIndex(e => e.logicalPath.includes('prompt'));
    const skillIdx = layer3.findIndex(e => e.logicalPath.includes('skill'));
    expect(promptIdx).toBeLessThan(skillIdx);
  });
});
