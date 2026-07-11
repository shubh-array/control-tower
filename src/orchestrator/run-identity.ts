import { createHash } from "node:crypto";

export interface RunInputHashComponents {
  harnessManifestHash: string;
  artifactSetHash: string;
  sourceHash: string;
  provenanceCatalogHash: string;
  modelSpecificationHash: string;
}

export function computeRunInputHash(components: RunInputHashComponents): string {
  const preimage = [
    components.harnessManifestHash,
    components.artifactSetHash,
    components.sourceHash,
    components.provenanceCatalogHash,
    components.modelSpecificationHash,
  ].join("\n");

  return createHash("sha256").update(preimage).digest("hex");
}

export function computeRunId(
  jobId: string,
  runInputHash: string,
  attemptNumber: number,
): string {
  const preimage = `${jobId}\n${runInputHash}\n${attemptNumber}`;
  return createHash("sha256").update(preimage).digest("hex");
}
