import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AttentionOutcomeSignal,
  DraftOutcomeSignal,
  DispositionSignal,
  TimingSignal,
  FailureSignal,
  SupersessionSignal,
  parseSignal,
  SignalSchema,
} from '../../src/learning/signals';
import { SignalRecorder } from '../../src/learning/record';
import Database from 'better-sqlite3';

describe('Learning Signal Schema', () => {
  it('validates a complete attention outcome signal', () => {
    const signal: AttentionOutcomeSignal = {
      type: 'attention_outcome',
      timestamp: '2026-07-10T12:00:00Z',
      jobId: 'job_abc123',
      runId: 'run_def456',
      policyDecisionHash: 'aabbccdd',
      runInputHash: '11223344',
      modelRole: 'attention',
      modelSpecHash: 'modelspec1',
      harnessManifestHash: 'harness1',
      contextHash: 'ctx1',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source',
      outcome: 'escalated',
    };
    const result = parseSignal(signal);
    expect(result.success).toBe(true);
  });

  it('validates a complete draft outcome signal', () => {
    const signal: DraftOutcomeSignal = {
      type: 'draft_outcome',
      timestamp: '2026-07-10T12:01:00Z',
      jobId: 'job_abc123',
      runId: 'run_def456',
      policyDecisionHash: 'aabbccdd',
      runInputHash: '11223344',
      modelRole: 'primaryReview',
      modelSpecHash: 'modelspec2',
      harnessManifestHash: 'harness2',
      contextHash: 'ctx2',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source',
      outcome: 'edited',
      agentDraftHash: 'draft_original',
      finalDraftHash: 'draft_edited',
      editDiff: { summary: 'rewording', inlineChanges: 2 },
    };
    const result = parseSignal(signal);
    expect(result.success).toBe(true);
  });

  it('validates a disposition signal', () => {
    const signal: DispositionSignal = {
      type: 'disposition',
      timestamp: '2026-07-10T12:02:00Z',
      jobId: 'job_abc123',
      runId: 'run_def456',
      policyDecisionHash: 'aabbccdd',
      runInputHash: '11223344',
      modelRole: 'primaryReview',
      modelSpecHash: 'modelspec2',
      harnessManifestHash: 'harness2',
      contextHash: 'ctx2',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source',
      finalDisposition: 'comment',
    };
    const result = parseSignal(signal);
    expect(result.success).toBe(true);
  });

  it('validates a timing/usage signal', () => {
    const signal: TimingSignal = {
      type: 'timing',
      timestamp: '2026-07-10T12:03:00Z',
      jobId: 'job_abc123',
      runId: 'run_def456',
      policyDecisionHash: 'aabbccdd',
      runInputHash: '11223344',
      modelRole: 'primaryReview',
      modelSpecHash: 'modelspec2',
      harnessManifestHash: 'harness2',
      contextHash: 'ctx2',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source',
      queueWaitMs: 5000,
      contextPrepMs: 3200,
      agentDurationMs: 45000,
      humanVerificationMs: 90000,
      publicationMs: 1200,
      cursorUsage: { inputTokens: 12000, outputTokens: 3400 },
    };
    const result = parseSignal(signal);
    expect(result.success).toBe(true);
  });

  it('validates a failure signal', () => {
    const signal: FailureSignal = {
      type: 'failure',
      timestamp: '2026-07-10T12:04:00Z',
      jobId: 'job_abc123',
      runId: 'run_def456',
      policyDecisionHash: 'aabbccdd',
      runInputHash: '11223344',
      modelRole: 'primaryReview',
      modelSpecHash: 'modelspec2',
      harnessManifestHash: 'harness2',
      contextHash: 'ctx2',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source',
      failureCategory: 'agent',
      failureCode: 'timeout',
      retryOf: null,
    };
    const result = parseSignal(signal);
    expect(result.success).toBe(true);
  });

  it('validates a supersession signal', () => {
    const signal: SupersessionSignal = {
      type: 'supersession',
      timestamp: '2026-07-10T12:05:00Z',
      jobId: 'job_abc123',
      runId: 'run_def456',
      policyDecisionHash: 'aabbccdd',
      runInputHash: '11223344',
      modelRole: 'primaryReview',
      modelSpecHash: 'modelspec2',
      harnessManifestHash: 'harness2',
      contextHash: 'ctx2',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source',
      supersededByJobId: 'job_xyz789',
      supersededByRunId: 'run_uvw012',
      reason: 'new_head_sha',
    };
    const result = parseSignal(signal);
    expect(result.success).toBe(true);
  });

  it('rejects signal with missing required fields', () => {
    const invalid = { type: 'attention_outcome', timestamp: '2026-07-10T12:00:00Z' };
    const result = parseSignal(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects signal with invalid outcome value', () => {
    const invalid = {
      type: 'attention_outcome',
      timestamp: '2026-07-10T12:00:00Z',
      jobId: 'job_abc123',
      runId: 'run_def456',
      policyDecisionHash: 'aabbccdd',
      runInputHash: '11223344',
      modelRole: 'attention',
      modelSpecHash: 'modelspec1',
      harnessManifestHash: 'harness1',
      contextHash: 'ctx1',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source',
      outcome: 'maybe',
    };
    const result = parseSignal(invalid);
    expect(result.success).toBe(false);
  });
});

describe('SignalRecorder', () => {
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

  it('records an attention outcome signal', () => {
    const signal = {
      type: 'attention_outcome' as const,
      timestamp: '2026-07-10T12:00:00Z',
      jobId: 'job_001',
      runId: 'run_001',
      policyDecisionHash: 'policy1',
      runInputHash: 'input1',
      modelRole: 'attention' as const,
      modelSpecHash: 'model1',
      harnessManifestHash: 'harness1',
      contextHash: 'ctx1',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source' as const,
      outcome: 'escalated' as const,
    };
    recorder.record(signal);
    const stored = recorder.queryByJobId('job_001');
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe('attention_outcome');
    expect(stored[0].outcome).toBe('escalated');
  });

  it('appends multiple signals for the same run', () => {
    const base = {
      timestamp: '2026-07-10T12:00:00Z',
      jobId: 'job_002',
      runId: 'run_002',
      policyDecisionHash: 'p2',
      runInputHash: 'i2',
      modelRole: 'primaryReview' as const,
      modelSpecHash: 'm2',
      harnessManifestHash: 'h2',
      contextHash: 'c2',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source' as const,
    };
    recorder.record({ ...base, type: 'draft_outcome', outcome: 'accepted', agentDraftHash: 'd1', finalDraftHash: 'd1', editDiff: null });
    recorder.record({ ...base, type: 'disposition', finalDisposition: 'approve' });
    const stored = recorder.queryByRunId('run_002');
    expect(stored).toHaveLength(2);
  });

  it('never updates or deletes existing signals', () => {
    const signal = {
      type: 'failure' as const,
      timestamp: '2026-07-10T12:00:00Z',
      jobId: 'job_003',
      runId: 'run_003',
      policyDecisionHash: 'p3',
      runInputHash: 'i3',
      modelRole: 'primaryReview' as const,
      modelSpecHash: 'm3',
      harnessManifestHash: 'h3',
      contextHash: 'c3',
      provenanceSchemaVersion: 1,
      sourceMode: 'remote-evidence-only' as const,
      failureCategory: 'agent' as const,
      failureCode: 'timeout',
      retryOf: null,
    };
    recorder.record(signal);
    const beforeCount = recorder.queryByJobId('job_003').length;
    recorder.record(signal);
    const afterCount = recorder.queryByJobId('job_003').length;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('queries signals by model role', () => {
    const base = {
      timestamp: '2026-07-10T12:00:00Z',
      jobId: 'job_004',
      runId: 'run_004',
      policyDecisionHash: 'p4',
      runInputHash: 'i4',
      modelSpecHash: 'm4',
      harnessManifestHash: 'h4',
      contextHash: 'c4',
      provenanceSchemaVersion: 1,
      sourceMode: 'registered-source' as const,
    };
    recorder.record({ ...base, type: 'attention_outcome', modelRole: 'attention', outcome: 'relevant' });
    recorder.record({ ...base, jobId: 'job_005', runId: 'run_005', type: 'draft_outcome', modelRole: 'primaryReview', outcome: 'accepted', agentDraftHash: 'd', finalDraftHash: 'd', editDiff: null });
    const attentionSignals = recorder.queryByRole('attention');
    expect(attentionSignals).toHaveLength(1);
    expect(attentionSignals[0].modelRole).toBe('attention');
  });
});
