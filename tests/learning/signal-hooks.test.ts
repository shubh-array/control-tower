import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SignalRecorder } from '../../src/learning/record';
import {
  createSignalHooks,
  type SignalHookDeps,
} from '../../src/learning/signal-hooks';

describe('SignalHooks', () => {
  let db: Database.Database;
  let recorder: SignalRecorder;

  beforeEach(() => {
    db = new Database(':memory:');
    recorder = new SignalRecorder(db);
    recorder.initialize();
  });

  afterEach(() => {
    db.close();
  });

  function makeDeps(overrides: Partial<SignalHookDeps> = {}): SignalHookDeps {
    return {
      recorder,
      getRunMeta: () => ({
        jobId: 'job_001',
        runId: 'run_001',
        policyDecisionHash: 'aabbccdd',
        runInputHash: '11223344',
        modelRole: 'primaryReview' as const,
        modelSpecHash: 'modelspec1',
        harnessManifestHash: 'harness1',
        contextHash: 'ctx1',
        provenanceSchemaVersion: 1,
        sourceMode: 'registered-source' as const,
      }),
      ...overrides,
    };
  }

  it('records a timing signal on pipeline seal', () => {
    const hooks = createSignalHooks(makeDeps());
    hooks.onPipelineSeal({
      queueWaitMs: 5000,
      contextPrepMs: 2000,
      agentDurationMs: 30000,
      humanVerificationMs: null,
      publicationMs: null,
      cursorUsage: { inputTokens: 8000, outputTokens: 2000 },
    });
    const signals = recorder.queryByJobId('job_001');
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('timing');
  });

  it('records a failure signal on pipeline seal with failure', () => {
    const hooks = createSignalHooks(makeDeps());
    hooks.onPipelineFailure({
      failureCategory: 'agent',
      failureCode: 'timeout',
      retryOf: null,
    });
    const signals = recorder.queryByJobId('job_001');
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('failure');
  });

  it('records a disposition signal on facade disposition', () => {
    const hooks = createSignalHooks(makeDeps());
    hooks.onDisposition('comment');
    const signals = recorder.queryByJobId('job_001');
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('disposition');
  });

  it('records an attention outcome signal on attention result', () => {
    const hooks = createSignalHooks(makeDeps({
      getRunMeta: () => ({
        jobId: 'job_002',
        runId: 'run_002',
        policyDecisionHash: 'eeff0011',
        runInputHash: '22334455',
        modelRole: 'attention' as const,
        modelSpecHash: 'attn_spec',
        harnessManifestHash: 'attn_harness',
        contextHash: 'attn_ctx',
        provenanceSchemaVersion: 1,
        sourceMode: 'registered-source' as const,
      }),
    }));
    hooks.onAttentionOutcome('escalated');
    const signals = recorder.queryByJobId('job_002');
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('attention_outcome');
  });

  it('running a fake pipeline records timing + disposition signals', () => {
    const hooks = createSignalHooks(makeDeps());
    hooks.onPipelineSeal({
      queueWaitMs: 1000,
      contextPrepMs: 500,
      agentDurationMs: 10000,
      humanVerificationMs: null,
      publicationMs: null,
      cursorUsage: { inputTokens: 4000, outputTokens: 1000 },
    });
    hooks.onDisposition('approve');
    const signals = recorder.queryByJobId('job_001');
    expect(signals).toHaveLength(2);
    expect(signals.map(s => s.type)).toEqual(['timing', 'disposition']);
  });
});
