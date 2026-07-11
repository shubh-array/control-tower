
export interface ReviewCaseExpectation {
  requiredFindings?: string[];
  forbiddenClaims?: string[];
  provenanceValid: boolean;
  acceptableDispositions?: string[];
}

export interface ReviewRunOutput {
  findings: Array<{
    title: string;
    provenanceRefs: string[];
    fileReferences: Array<{ path: string; blobSha: string; startLine: number; endLine: number }>;
  }>;
  observations: Array<{
    provenanceRefs: string[];
    fileReferences: Array<{ path: string; blobSha: string }>;
  }>;
  recommendedDisposition: string;
}

export function computeProvenanceValidity(
  output: ReviewRunOutput,
  validProvenanceIds: Set<string>,
  validBlobShas: Set<string>,
): number {
  let totalRefs = 0;
  let validRefs = 0;

  for (const obs of output.observations) {
    for (const ref of obs.provenanceRefs) {
      totalRefs++;
      if (validProvenanceIds.has(ref)) validRefs++;
    }
    for (const fileRef of obs.fileReferences) {
      totalRefs++;
      if (validBlobShas.has(fileRef.blobSha)) validRefs++;
    }
  }

  if (totalRefs === 0) return 0.0;
  return validRefs / totalRefs;
}

export function computeFindingRecall(
  output: ReviewRunOutput,
  expected: ReviewCaseExpectation,
): number {
  if (!expected.requiredFindings || expected.requiredFindings.length === 0) return 1.0;
  const foundTitles = output.findings.map(f => f.title.toLowerCase());
  const hits = expected.requiredFindings.filter(
    req => foundTitles.some(t => t.includes(req.toLowerCase()))
  );
  return hits.length / expected.requiredFindings.length;
}

export function computeFalsePositiveRate(
  output: ReviewRunOutput,
  expected: ReviewCaseExpectation,
): number {
  if (!expected.forbiddenClaims || expected.forbiddenClaims.length === 0) return 0.0;
  const allText = output.findings.map(f => f.title.toLowerCase()).join(' ');
  const violations = expected.forbiddenClaims.filter(
    claim => allText.includes(claim.toLowerCase())
  );
  return violations.length / expected.forbiddenClaims.length;
}
