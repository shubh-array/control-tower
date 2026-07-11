import { z } from 'zod';

const BaseSignalSchema = z.object({
  timestamp: z.string().datetime(),
  jobId: z.string().min(1),
  runId: z.string().min(1),
  policyDecisionHash: z.string().min(1),
  runInputHash: z.string().min(1),
  modelRole: z.enum(['attention', 'primaryReview']),
  modelSpecHash: z.string().min(1),
  harnessManifestHash: z.string().min(1),
  contextHash: z.string().min(1),
  provenanceSchemaVersion: z.number().int().positive(),
  sourceMode: z.enum(['registered-source', 'remote-evidence-only']),
});

const AttentionOutcomeSchema = BaseSignalSchema.extend({
  type: z.literal('attention_outcome'),
  outcome: z.enum(['relevant', 'ignored', 'escalated']),
});

const DraftOutcomeSchema = BaseSignalSchema.extend({
  type: z.literal('draft_outcome'),
  outcome: z.enum(['accepted', 'edited', 'rejected']),
  agentDraftHash: z.string().min(1),
  finalDraftHash: z.string().min(1),
  editDiff: z.object({
    summary: z.string(),
    inlineChanges: z.number().int().nonnegative(),
  }).nullable(),
});

const DispositionSchema = BaseSignalSchema.extend({
  type: z.literal('disposition'),
  finalDisposition: z.enum([
    'no_publication', 'comment', 'approve',
    'request_changes', 'closed', 'superseded',
  ]),
});

const TimingSchema = BaseSignalSchema.extend({
  type: z.literal('timing'),
  queueWaitMs: z.number().nonnegative(),
  contextPrepMs: z.number().nonnegative(),
  agentDurationMs: z.number().nonnegative(),
  humanVerificationMs: z.number().nonnegative().nullable(),
  publicationMs: z.number().nonnegative().nullable(),
  cursorUsage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

const FailureSchema = BaseSignalSchema.extend({
  type: z.literal('failure'),
  failureCategory: z.enum(['connector', 'source', 'agent', 'validation', 'publication']),
  failureCode: z.string().min(1),
  retryOf: z.string().nullable(),
});

const SupersessionSchema = BaseSignalSchema.extend({
  type: z.literal('supersession'),
  supersededByJobId: z.string().min(1),
  supersededByRunId: z.string().min(1),
  reason: z.enum(['new_head_sha', 'policy_change', 'cancelled', 'daemon_restart']),
});

export const SignalSchema = z.discriminatedUnion('type', [
  AttentionOutcomeSchema,
  DraftOutcomeSchema,
  DispositionSchema,
  TimingSchema,
  FailureSchema,
  SupersessionSchema,
]);

export type AttentionOutcomeSignal = z.infer<typeof AttentionOutcomeSchema>;
export type DraftOutcomeSignal = z.infer<typeof DraftOutcomeSchema>;
export type DispositionSignal = z.infer<typeof DispositionSchema>;
export type TimingSignal = z.infer<typeof TimingSchema>;
export type FailureSignal = z.infer<typeof FailureSchema>;
export type SupersessionSignal = z.infer<typeof SupersessionSchema>;
export type LearningSignal = z.infer<typeof SignalSchema>;

export function parseSignal(data: unknown): z.SafeParseReturnType<unknown, LearningSignal> {
  return SignalSchema.safeParse(data);
}
