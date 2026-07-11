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
