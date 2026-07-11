import type { SignalRecorder } from './record.js';
import type {
  TimingSignal,
  FailureSignal,
  DispositionSignal,
  AttentionOutcomeSignal,
} from './signals.js';

export interface RunMeta {
  jobId: string;
  runId: string;
  policyDecisionHash: string;
  runInputHash: string;
  modelRole: 'attention' | 'primaryReview';
  modelSpecHash: string;
  harnessManifestHash: string;
  contextHash: string;
  provenanceSchemaVersion: number;
  sourceMode: 'registered-source' | 'remote-evidence-only';
}

export interface SignalHookDeps {
  recorder: SignalRecorder;
  getRunMeta: () => RunMeta;
}

export interface SignalHooks {
  onPipelineSeal(timing: Omit<TimingSignal, 'type' | 'timestamp' | keyof RunMeta>): void;
  onPipelineFailure(failure: Pick<FailureSignal, 'failureCategory' | 'failureCode' | 'retryOf'>): void;
  onDisposition(finalDisposition: DispositionSignal['finalDisposition']): void;
  onAttentionOutcome(outcome: AttentionOutcomeSignal['outcome']): void;
}

export function createSignalHooks(deps: SignalHookDeps): SignalHooks {
  function meta(): RunMeta & { timestamp: string } {
    return { ...deps.getRunMeta(), timestamp: new Date().toISOString() };
  }

  return {
    onPipelineSeal(timing) {
      const m = meta();
      deps.recorder.record({
        ...m,
        type: 'timing',
        queueWaitMs: timing.queueWaitMs,
        contextPrepMs: timing.contextPrepMs,
        agentDurationMs: timing.agentDurationMs,
        humanVerificationMs: timing.humanVerificationMs ?? null,
        publicationMs: timing.publicationMs ?? null,
        cursorUsage: timing.cursorUsage,
      } as TimingSignal);
    },

    onPipelineFailure(failure) {
      const m = meta();
      deps.recorder.record({
        ...m,
        type: 'failure',
        failureCategory: failure.failureCategory,
        failureCode: failure.failureCode,
        retryOf: failure.retryOf,
      } as FailureSignal);
    },

    onDisposition(finalDisposition) {
      const m = meta();
      deps.recorder.record({
        ...m,
        type: 'disposition',
        finalDisposition,
      } as DispositionSignal);
    },

    onAttentionOutcome(outcome) {
      const m = meta();
      deps.recorder.record({
        ...m,
        type: 'attention_outcome',
        outcome,
      } as AttentionOutcomeSignal);
    },
  };
}
