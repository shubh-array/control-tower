import {
  isAllowedTarget,
  MAX_PROPOSAL_TARGETS,
  MAX_PROPOSAL_SIZE_BYTES,
  MAX_PER_FILE_SIZE_BYTES,
  type ProfileChangeProposal,
  type ProposalValidationResult,
} from './types.js';

interface CurrentFileInfo {
  content: string;
  hash: string;
}

export function validateProposal(
  proposal: ProfileChangeProposal,
  currentFiles: Record<string, CurrentFileInfo>,
): ProposalValidationResult {
  const errors: string[] = [];
  const targetValidation: Record<string, { allowed: boolean; schemaValid: boolean; baseHashMatch: boolean }> = {};

  if (proposal.targets.length > MAX_PROPOSAL_TARGETS) {
    errors.push(`Target count (${proposal.targets.length}) exceeds maximum (${MAX_PROPOSAL_TARGETS})`);
  }

  let totalSize = 0;

  for (const target of proposal.targets) {
    const allowed = isAllowedTarget(target.path);
    const fileInfo = currentFiles[target.path];
    const baseHashMatch = fileInfo ? fileInfo.hash === target.baseContentHash : false;
    const contentSize = Buffer.byteLength(target.proposedContent, 'utf-8');
    const schemaValid = contentSize <= MAX_PER_FILE_SIZE_BYTES;

    targetValidation[target.path] = { allowed, schemaValid, baseHashMatch };

    if (!allowed) {
      errors.push(`Target "${target.path}" is not in the allowlist`);
    }
    if (!baseHashMatch) {
      errors.push(`Base hash mismatch for "${target.path}": expected "${fileInfo?.hash}", got "${target.baseContentHash}"`);
    }
    if (!schemaValid) {
      errors.push(`Target "${target.path}" proposed content (${contentSize} bytes) exceeds 256 KiB limit`);
    }

    totalSize += contentSize;
  }

  if (totalSize > MAX_PROPOSAL_SIZE_BYTES) {
    errors.push(`Total proposal size (${totalSize} bytes) exceeds 1 MiB limit`);
  }

  return { valid: errors.length === 0, errors, targetValidation };
}
