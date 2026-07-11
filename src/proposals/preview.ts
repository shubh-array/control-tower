import { sha256Hex } from '../util/hash.js';

export interface PreviewLine {
  type: 'unchanged' | 'added' | 'removed';
  lineNumber: number;
  content: string;
}

export interface ProposalPreview {
  proposalId: string;
  targetPath: string;
  baseHash: string;
  proposedHash: string;
  lines: PreviewLine[];
}

export function generatePreview(
  proposalId: string,
  targetPath: string,
  baseContent: string,
  proposedContent: string,
): ProposalPreview {
  const baseLines = baseContent.split('\n');
  const proposedLines = proposedContent.split('\n');
  const lines: PreviewLine[] = [];

  const maxLen = Math.max(baseLines.length, proposedLines.length);
  for (let i = 0; i < maxLen; i++) {
    const baseLine = baseLines[i];
    const propLine = proposedLines[i];

    if (baseLine === propLine) {
      lines.push({ type: 'unchanged', lineNumber: i + 1, content: propLine ?? '' });
    } else {
      if (baseLine !== undefined) {
        lines.push({ type: 'removed', lineNumber: i + 1, content: baseLine });
      }
      if (propLine !== undefined) {
        lines.push({ type: 'added', lineNumber: i + 1, content: propLine });
      }
    }
  }

  return {
    proposalId,
    targetPath,
    baseHash: sha256Hex(baseContent),
    proposedHash: sha256Hex(proposedContent),
    lines,
  };
}
