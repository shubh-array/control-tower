import { randomUUID } from "node:crypto";
import type { SignalRecorder } from "../learning/record.js";
import { sha256Hex, sha256OfCanonicalJson } from "../util/hash.js";
import type { ProfileChangeProposal, ProposalTarget } from "./types.js";
import {
  runProposalPipeline,
  type CursorRunAdapter,
} from "./run.js";
import type { CorpusCase, ReplayConfig } from "./replay.js";

const MAX_SIGNAL_RUNS = 50;
const MAX_SIGNAL_BYTES = 2 * 1024 * 1024;

export interface StartProposalConfig {
  signalRunIds: string[];
  recorder: SignalRecorder;
  currentFiles: Record<string, { content: string; hash: string }>;
  profileDir: string;
  corpusCases: CorpusCase[];
  modelSpec: string;
  evaluator: ReplayConfig["evaluator"];
  cursorAdapter: CursorRunAdapter;
}

interface AgentProposalOutput {
  targets?: Array<{
    path: string;
    proposedContent: string;
    rationale: string;
    expectedEffect?: string;
    risks?: string[];
    replayCases?: string[];
    baseContentHash?: string;
  }>;
}

export async function startProposalFromSignals(
  config: StartProposalConfig,
): Promise<ProfileChangeProposal> {
  const { signalRunIds, recorder, currentFiles, profileDir, corpusCases, modelSpec, evaluator, cursorAdapter } =
    config;

  if (signalRunIds.length === 0) {
    throw new Error("At least one signal run is required");
  }
  if (signalRunIds.length > MAX_SIGNAL_RUNS) {
    throw new Error(`Maximum ${MAX_SIGNAL_RUNS} signal runs allowed`);
  }

  const signals = signalRunIds.flatMap((runId) => recorder.queryByRunId(runId));
  const signalsPayload = JSON.stringify(signals);
  if (Buffer.byteLength(signalsPayload, "utf-8") > MAX_SIGNAL_BYTES) {
    throw new Error("Selected signals exceed 2 MiB limit");
  }

  const selectedSignalHash = sha256Hex(signalsPayload);
  const proposalId = `prop_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const agentResult = await cursorAdapter.run(
    JSON.stringify({
      signalRunIds,
      signals: signals.map((s) => ({
        type: s.type,
        runId: s.runId,
        modelRole: s.modelRole,
        jobId: s.jobId,
      })),
    }),
    "primaryReview",
    "profile-proposal",
  );

  const output = agentResult.output as AgentProposalOutput;
  let targets: ProposalTarget[] = (output.targets ?? []).map((t) => ({
    path: t.path,
    baseContentHash: t.baseContentHash ?? currentFiles[t.path]?.hash ?? "",
    proposedContent: t.proposedContent,
    rationale: t.rationale,
    expectedEffect: t.expectedEffect ?? "",
    risks: t.risks ?? [],
    replayCases: t.replayCases ?? [],
  }));

  if (targets.length === 0 && currentFiles["persona.md"]) {
    const persona = currentFiles["persona.md"];
    targets = [
      {
        path: "persona.md",
        baseContentHash: persona.hash,
        proposedContent: persona.content,
        rationale: `Proposal scaffold informed by ${signals.length} learning signal(s)`,
        expectedEffect: "Preserves current persona pending agent-generated changes",
        risks: [],
        replayCases: [],
      },
    ];
  }

  const proposal: ProfileChangeProposal = {
    id: proposalId,
    version: 1,
    createdAt: new Date().toISOString(),
    selectedSignalHash,
    targetBaseContentHashes: Object.fromEntries(
      targets.map((t) => [t.path, t.baseContentHash]),
    ),
    immutableProposalContractHash: sha256OfCanonicalJson({
      proposalId,
      selectedSignalHash,
      targetPaths: targets.map((t) => t.path),
    }),
    personaHash: currentFiles["persona.md"]?.hash ?? sha256Hex(""),
    modelSpecHash: sha256Hex(modelSpec),
    targets,
    status: "pending_validation",
  };

  const pipelineResult = await runProposalPipeline({
    proposal,
    profileDir,
    currentFiles,
    corpusCases,
    modelSpec,
    evaluator,
    cursorAdapter,
  });

  if (pipelineResult.validationPassed && pipelineResult.replayCompleted) {
    proposal.status = "previewed";
  }

  return proposal;
}
