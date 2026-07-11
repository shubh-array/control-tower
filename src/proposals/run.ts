import type { ProfileChangeProposal } from './types.js';
import { validateProposal } from './validate.js';
import { runHistoricalReplay, type ReplayConfig } from './replay.js';

export interface CursorRunAdapter {
  run(prompt: string, modelRole: string, runKind: string): Promise<{ exitCode: number; output: unknown }>;
}

export interface ProposalRunConfig {
  proposal: ProfileChangeProposal;
  profileDir: string;
  currentFiles: Record<string, { content: string; hash: string }>;
  corpusCases: ReplayConfig['corpusCases'];
  modelSpec: string;
  evaluator: ReplayConfig['evaluator'];
  cursorAdapter: CursorRunAdapter;
}

export interface ProposalRunResult {
  proposalId: string;
  validationPassed: boolean;
  validationErrors: string[];
  replayCompleted: boolean;
  replayMetrics: Record<string, number>;
  replayCasesPassed: number;
  replayCasesTotal: number;
}

export async function runProposalPipeline(config: ProposalRunConfig): Promise<ProposalRunResult> {
  const validation = validateProposal(config.proposal, config.currentFiles);

  if (!validation.valid) {
    return {
      proposalId: config.proposal.id,
      validationPassed: false,
      validationErrors: validation.errors,
      replayCompleted: false,
      replayMetrics: {},
      replayCasesPassed: 0,
      replayCasesTotal: 0,
    };
  }

  const affectedRole = config.proposal.targets.some(t => t.path.includes('harnesses/pr-attention'))
    ? 'attention' as const
    : 'primaryReview' as const;

  await config.cursorAdapter.run(
    JSON.stringify({
      proposalId: config.proposal.id,
      targets: config.proposal.targets,
      selectedSignals: config.corpusCases.map(c => c.caseId),
    }),
    'primaryReview',
    'profile-proposal',
  );

  const replayConfig: ReplayConfig = {
    proposalId: config.proposal.id,
    role: affectedRole,
    proposedManifest: { harnessManifestHash: config.proposal.immutableProposalContractHash },
    corpusCases: config.corpusCases,
    modelSpec: config.modelSpec,
    evaluator: config.evaluator,
  };

  const replayResult = await runHistoricalReplay(replayConfig);
  const passed = replayResult.caseResults.filter(c => c.passed).length;

  return {
    proposalId: config.proposal.id,
    validationPassed: true,
    validationErrors: [],
    replayCompleted: true,
    replayMetrics: replayResult.metrics,
    replayCasesPassed: passed,
    replayCasesTotal: replayResult.caseResults.length,
  };
}
