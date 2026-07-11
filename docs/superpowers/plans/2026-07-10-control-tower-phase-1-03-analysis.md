# Control Tower Phase 1 — Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete analysis pipeline: orchestrator state machine, optional pr-attention advisor, secure source workspace management, nine-layer context builder, Cursor CLI adapter with NDJSON parsing, review output validation with provenance, and a fail-closed protect-inputs hook.

**Architecture:** The orchestrator owns attention/job/run states with compare-and-set transitions backed by SQLite. The source manager enforces a strict fetch→verify→materialize pipeline with credential isolation. The context builder assembles a nine-layer harness manifest and provenance catalog into a create-once/seal-on-complete run directory. The Cursor CLI adapter spawns at most two concurrent agent processes, parses NDJSON streams, validates model identity, and enforces role-specific timeouts. The review output validator enforces strict schema conformance and provenance chain integrity before any draft reaches the workbench.

**Tech Stack:** TypeScript, Node.js, SQLite (via plan 01), Vitest, node:crypto for SHA-256, node:child_process for Cursor/Git subprocesses.

**Depends on:** plans 01 (foundation: config schema, SQLite, CanonicalPathMatcher) and 02 (discovery: GitHub adapter, policy evaluator, work graph/All Tracked)

**Unlocks:** plan 04 (workbench needs accepted drafts from validated runs); plan 05 (eval corpora need sealed run artifacts)

---

## Prerequisites from Plans 01–02

This plan imports from modules established by prior plans. The assumed interfaces are:

```typescript
// src/config/schema.ts — plan 01
export interface RepositoryCatalogEntry {
  id: string;
  github: { host: string; owner: string; repo: string };
  remoteUrl: string;
  active: boolean;
}
export interface MachineConfig {
  schemaVersion: number;
  dataDirectory: string;
  cursor: {
    binary: string;
    modelRoles: Record<string, { modelId: string }>;
    maxConcurrentAgents: number;
  };
  worktrees: { maxMaterialized: number };
}
export interface ProfileConfig {
  githubLogin: string;
  hosts: Array<{ host: string }>;
}

// src/store/db.ts — plan 01
export function openDatabase(path: string): import('better-sqlite3').Database;
export interface Database {
  run(sql: string, params?: unknown[]): RunResult;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  transaction<T>(fn: () => T): T;
}
export interface RunResult { changes: number; lastInsertRowid: number | bigint }

// src/paths/matcher.ts — plan 01
export interface CanonicalPathMatcher {
  version: string;
  contentHash: string;
  matches(path: string): boolean;
  canonicalize(rawPath: string): string | null;
}

// src/util/hash.ts — plan 01
export function sha256Hex(data: string | Buffer): string;
export function sha256OfCanonicalJson(value: unknown): string;

// src/security/child-env.ts — plan 01
export function buildCursorEnv(host: Record<string, string | undefined>): Record<string, string>;
export function buildGhEnv(host: Record<string, string | undefined>, opts: GhEnvOptions): Record<string, string>;
export function buildGitFetchEnv(host: Record<string, string | undefined>, opts: GitFetchEnvOptions): Record<string, string>;
export function buildGitLocalEnv(host: Record<string, string | undefined>): Record<string, string>;

// src/policy/evaluate.ts — plan 02 (flat PolicyDecision; do not invent a nested shape)
export type PriorityStatus = 'p0' | 'p1' | 'p2' | 'p3' | 'unranked';
export type AnalysisMode = 'auto' | 'on_demand';

export interface PolicyDecision {
  eligible: boolean;
  eligibilityReasons: EligibilityReason[];
  exclusionReasons: ExclusionReason[];
  authorOnly: boolean;
  priorityStatus: PriorityStatus;
  prioritySortOrdinal: number;
  priorityReasons: PriorityReason[];
  allPriorityReasons: PriorityReason[];
  selectedPriorityReason: PriorityReason | null;
  analysisMode: AnalysisMode;
  autoAnalyzeReasons: AutoAnalyzeReason[];
  selectedDomains: SelectedDomain[];
  allDomainReasons: DomainMatchReason[];
}

export interface SelectedDomain {
  domain: string;
  selectedPriority: number;
  selectedDeclarationIndex: number;
  matchedPaths: string[];
  allReasons: DomainMatchReason[];
}

// All Tracked row shape used by attention candidate selection (projected from SQLite + PolicyDecision)
export interface AllTrackedItem {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: CheckSummaryEntry[];
  updatedAt: string | null;
  explicitRequestTimestamp: string | null;
  policy: PolicyDecision;
  sourceMode: 'registered-source' | 'remote-evidence-only';
  bodyTruncated: string;
}

export interface QueueTuple {
  prioritySortOrdinal: number;
  explicitRequestSort: number;
  queueTimestampSort: string; // UTC instant or deterministic "unknown" sentinel after all valid instants
  normalizedRepositoryIdentity: string;
  prNumber: number;
}
```

### SQL ↔ TypeScript Column Mapping

All `updated_at`, `created_at`, and timestamp columns store ISO 8601 TEXT (e.g. `2026-07-10T12:00:00.000Z`). TypeScript writes via `new Date().toISOString()`. SQLite reads via standard TEXT comparison (ISO sorts lexicographically).

| SQL column | TypeScript field | Notes |
|---|---|---|
| `policy_hash` | `policyDecisionHash` | SHA-256 of canonical PolicyDecision + matcher version |
| `identity_hash` | `identityHash` | Pre-context job identity hash |
| `updated_at` | `updatedAt` | ISO 8601 TEXT, never epoch millis |
| `queued_at` | `queuedAt` | ISO 8601 TEXT |
| `created_at` | `createdAt` | ISO 8601 TEXT |
| `repository_key` | `repositoryKey` | snake_case → camelCase via SQL alias |
| `pr_number` | `prNumber` | snake_case → camelCase via SQL alias |
| `priority_sort_ordinal` | `prioritySortOrdinal` | snake_case → camelCase via SQL alias |
| `explicit_request_sort` | `explicitRequestSort` | snake_case → camelCase via SQL alias |
| `normalized_repository_identity` | `normalizedRepositoryIdentity` | snake_case → camelCase via SQL alias |

---

## File Structure

### `src/orchestrator/` — State machine, identities, scheduling

| File | Responsibility |
|------|---------------|
| `attention-state.ts` | Attention state enum, terminal check, projection rules |
| `job-state.ts` | Job state enum, terminal states, allowed transition graph |
| `run-state.ts` | Run state enum for `primaryReview` and advisor attempts |
| `transitions.ts` | Compare-and-set transition engine with SQLite transactions |
| `job-identity.ts` | Pre-context job identity hash (excludes harness/model/context) |
| `run-identity.ts` | Post-context run-input hash and run ID derivation |
| `recovery.ts` | Restart reconciliation for orphaned/expired states |
| `scheduler.ts` | Fair queue with concurrency limit and debounce |
| `work-graph.ts` | Project SQLite prs + attention_items + PolicyDecision → AllTrackedItem[]; getFocusQueue |
| `enqueue.ts` | Create/reuse/supersede jobs from poll PolicyDecisions |
| `pipeline.ts` | Execute one job through state machine with injected deps |
| `facade.ts` | Public OrchestratorFacade API consumed by Plan 04 workbench |
| `failure-recovery.ts` | §12 source/agent/advisor failure handlers (fetch, materialize, advisor, agent) |

### `src/daemon/` — Runtime lifecycle

| File | Responsibility |
|------|---------------|
| `runtime.ts` | Daemon startup: migrate → recovery → poller → scheduler loop → attention batch |

### `src/attention/` — Optional pr-attention advisor

| File | Responsibility |
|------|---------------|
| `candidates.ts` | Deterministic candidate batch selection from All Tracked |
| `staleness.ts` | Per-PR staleness identity computation |
| `advisor-order.ts` | Global advisor order: relevance → risk → deterministic tuple |
| `validate-output.ts` | Strict advisor output schema + candidate coverage validation |
| `run.ts` | Attention run orchestration: metadata-only, no source, no --add-dir |

### `src/source/` — Secure workspace management

| File | Responsibility |
|------|---------------|
| `fetch-boundary.ts` | Authenticated SSH/HTTPS mirror fetch with credential isolation |
| `materialize.ts` | Credential-free blob materialization + admin worktree + cleanup |
| `remote-evidence.ts` | Remote-evidence-only path: metadata + filtered diff, no source |
| `cleanup.ts` | Post-seal removal of source view/admin pairs, storage limits |

### `src/context/` — Run directory and harness composition

| File | Responsibility |
|------|---------------|
| `harness-manifest.ts` | Nine-layer manifest builder with deterministic entry ordinals |
| `provenance.ts` | Application-created provenance catalog with `pv_` IDs |
| `coverage.ts` | Coverage object: source mode, omissions, missing coverage |
| `prepare.ts` | Run directory creation, frozen input writing, context-refs |
| `seal.ts` | terminal.json write, directory immutability, run sealing |

### `src/cursor/` — CLI adapter and output processing

| File | Responsibility |
|------|---------------|
| `argv.ts` | Exact Cursor CLI argument vector construction |
| `ndjson.ts` | Streaming NDJSON parser for Cursor output events |
| `adapter.ts` | Child process lifecycle, timeout, SIGTERM/SIGKILL |
| `pool.ts` | Worker pool with max 1–2 concurrency |
| `validate-review.ts` | primaryReview output schema + provenance chain validator |
| `hooks/protect-inputs-template.mjs` | Fail-closed beforeReadFile hook template |

### Test files

Each test file maps to the source module in the table above under `tests/<module>/`.
Integration tests live in `tests/integration/analysis-pipeline.test.ts`.

---

## Task 1: Orchestrator State Types

**Files:**
- Create: `src/orchestrator/attention-state.ts`
- Create: `src/orchestrator/job-state.ts`
- Create: `src/orchestrator/run-state.ts`

- [x] **Step 1: Create attention state types**

```typescript
// src/orchestrator/attention-state.ts

export const ATTENTION_STATES = [
  'monitoring',
  'ready_for_analysis',
  'analysis_queued',
  'draft_ready',
  'needs_human',
  'completed',
  'closed',
] as const;

export type AttentionState = (typeof ATTENTION_STATES)[number];

const TERMINAL: ReadonlySet<AttentionState> = new Set(['completed', 'closed']);

export function isTerminalAttention(state: AttentionState): boolean {
  return TERMINAL.has(state);
}
```

- [x] **Step 2: Create job state types**

```typescript
// src/orchestrator/job-state.ts

export const JOB_STATES = [
  'queued',
  'preparing_context',
  'preparing_source',
  'running_agent',
  'validating_output',
  'draft_ready',
  'awaiting_approval',
  'publishing',
  'published',
  'failed',
  'cancelled',
  'superseded',
] as const;

export type JobState = (typeof JOB_STATES)[number];

const TERMINAL: ReadonlySet<JobState> = new Set([
  'published',
  'cancelled',
  'superseded',
]);

const PRE_PUBLICATION_NONTERMINAL: ReadonlySet<JobState> = new Set([
  'queued',
  'preparing_context',
  'preparing_source',
  'running_agent',
  'validating_output',
  'draft_ready',
]);

export function isTerminalJob(state: JobState): boolean {
  return TERMINAL.has(state);
}

export function isPrePublicationNonterminal(state: JobState): boolean {
  return PRE_PUBLICATION_NONTERMINAL.has(state);
}

export const ALLOWED_JOB_TRANSITIONS: ReadonlyMap<JobState, ReadonlySet<JobState>> = new Map([
  ['queued', new Set(['preparing_context', 'failed', 'cancelled', 'superseded'])],
  ['preparing_context', new Set(['preparing_source', 'running_agent', 'failed', 'cancelled', 'superseded'])],
  ['preparing_source', new Set(['running_agent', 'failed', 'cancelled', 'superseded'])],
  ['running_agent', new Set(['validating_output', 'failed', 'cancelled', 'superseded'])],
  ['validating_output', new Set(['draft_ready', 'failed', 'cancelled', 'superseded'])],
  ['draft_ready', new Set(['awaiting_approval', 'failed', 'cancelled', 'superseded'])],
  ['awaiting_approval', new Set(['publishing', 'failed', 'cancelled', 'superseded'])],
  ['publishing', new Set(['published', 'failed', 'cancelled', 'superseded'])],
  ['failed', new Set(['queued', 'superseded'])],
]);
```

- [x] **Step 3: Create run state types**

```typescript
// src/orchestrator/run-state.ts

export const RUN_STATES = [
  'allocated',
  'running',
  'validating',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
] as const;

export type RunState = (typeof RUN_STATES)[number];

const TERMINAL: ReadonlySet<RunState> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
]);

export function isTerminalRun(state: RunState): boolean {
  return TERMINAL.has(state);
}

export const ALLOWED_RUN_TRANSITIONS: ReadonlyMap<RunState, ReadonlySet<RunState>> = new Map([
  ['allocated', new Set(['running', 'failed', 'cancelled', 'superseded'])],
  ['running', new Set(['validating', 'failed', 'cancelled', 'superseded'])],
  ['validating', new Set(['succeeded', 'failed', 'cancelled', 'superseded'])],
]);

export const ADVISOR_RUN_STATES = [
  'queued',
  'running',
  'validating',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
] as const;

export type AdvisorRunState = (typeof ADVISOR_RUN_STATES)[number];

export const ALLOWED_ADVISOR_TRANSITIONS: ReadonlyMap<AdvisorRunState, ReadonlySet<AdvisorRunState>> = new Map([
  ['queued', new Set(['running', 'failed', 'cancelled', 'superseded'])],
  ['running', new Set(['validating', 'failed', 'cancelled', 'superseded'])],
  ['validating', new Set(['succeeded', 'failed', 'cancelled', 'superseded'])],
]);
```

- [x] **Step 4: Commit**

```bash
git add src/orchestrator/attention-state.ts src/orchestrator/job-state.ts src/orchestrator/run-state.ts
git commit -m "feat(orchestrator): add attention, job, and run state type definitions"
```

---

## Task 2: Compare-and-Set Transition Engine

**Files:**
- Create: `src/orchestrator/transitions.ts`
- Test: `tests/orchestrator/transitions.test.ts`

- [x] **Step 1: Write failing tests for transition validation**

```typescript
// tests/orchestrator/transitions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  transitionJob,
  transitionRun,
  transitionAdvisorRun,
  TransitionError,
} from '../../src/orchestrator/transitions.js';
import type { Database } from '../../src/store/db.js';

function createMockDb(): Database & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    run(sql: string, params?: unknown[]) {
      return { changes: 1, lastInsertRowid: 1 };
    },
    get<T>(sql: string, params?: unknown[]): T | undefined {
      const key = params?.[0] as string;
      return rows.get(key) as T | undefined;
    },
    all<T>(): T[] { return []; },
    transaction<T>(fn: () => T): T { return fn(); },
  };
}

describe('transitionJob', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('allows queued -> preparing_context', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'queued', version: 1, identityHash: 'id-1' });
    const result = transitionJob(db, {
      jobId: 'job-1',
      expectedState: 'queued',
      expectedVersion: 1,
      newState: 'preparing_context',
    });
    expect(result.success).toBe(true);
  });

  it('rejects illegal transition queued -> running_agent', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'queued', version: 1, identityHash: 'id-1' });
    expect(() =>
      transitionJob(db, {
        jobId: 'job-1',
        expectedState: 'queued',
        expectedVersion: 1,
        newState: 'running_agent',
      })
    ).toThrow(TransitionError);
  });

  it('rejects transition when current state does not match expected', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'preparing_context', version: 2, identityHash: 'id-1' });
    expect(() =>
      transitionJob(db, {
        jobId: 'job-1',
        expectedState: 'queued',
        expectedVersion: 2,
        newState: 'preparing_context',
      })
    ).toThrow(TransitionError);
  });

  it('rejects transition when version does not match', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'queued', version: 3, identityHash: 'id-1' });
    expect(() =>
      transitionJob(db, {
        jobId: 'job-1',
        expectedState: 'queued',
        expectedVersion: 1,
        newState: 'preparing_context',
      })
    ).toThrow(TransitionError);
  });

  it('terminal states cannot transition', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'published', version: 1, identityHash: 'id-1' });
    expect(() =>
      transitionJob(db, {
        jobId: 'job-1',
        expectedState: 'published',
        expectedVersion: 1,
        newState: 'queued',
      })
    ).toThrow(TransitionError);
  });

  it('failed -> queued requires manualRetry flag', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'failed', version: 5, identityHash: 'id-1' });
    expect(() =>
      transitionJob(db, {
        jobId: 'job-1',
        expectedState: 'failed',
        expectedVersion: 5,
        newState: 'queued',
      })
    ).toThrow(TransitionError);

    const result = transitionJob(db, {
      jobId: 'job-1',
      expectedState: 'failed',
      expectedVersion: 5,
      newState: 'queued',
      manualRetry: true,
    });
    expect(result.success).toBe(true);
  });

  it('preparing_context -> running_agent allowed for remote-evidence-only', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'preparing_context', version: 1, identityHash: 'id-1' });
    const result = transitionJob(db, {
      jobId: 'job-1',
      expectedState: 'preparing_context',
      expectedVersion: 1,
      newState: 'running_agent',
    });
    expect(result.success).toBe(true);
  });

  it('duplicate event on same version is idempotent no-op', () => {
    db.rows.set('job-1', { id: 'job-1', state: 'preparing_context', version: 2, identityHash: 'id-1' });
    const result = transitionJob(db, {
      jobId: 'job-1',
      expectedState: 'preparing_context',
      expectedVersion: 2,
      newState: 'preparing_context',
      idempotencyKey: 'evt-1',
    });
    expect(result.success).toBe(true);
    expect(result.alreadyApplied).toBe(true);
  });
});

describe('transitionRun', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('allows allocated -> running -> validating -> succeeded', () => {
    db.rows.set('run-1', { id: 'run-1', state: 'allocated', version: 1 });
    expect(transitionRun(db, { runId: 'run-1', expectedState: 'allocated', expectedVersion: 1, newState: 'running' }).success).toBe(true);

    db.rows.set('run-1', { id: 'run-1', state: 'running', version: 2 });
    expect(transitionRun(db, { runId: 'run-1', expectedState: 'running', expectedVersion: 2, newState: 'validating' }).success).toBe(true);

    db.rows.set('run-1', { id: 'run-1', state: 'validating', version: 3 });
    expect(transitionRun(db, { runId: 'run-1', expectedState: 'validating', expectedVersion: 3, newState: 'succeeded' }).success).toBe(true);
  });

  it('terminal run states are immutable', () => {
    db.rows.set('run-1', { id: 'run-1', state: 'succeeded', version: 4 });
    expect(() =>
      transitionRun(db, { runId: 'run-1', expectedState: 'succeeded', expectedVersion: 4, newState: 'running' })
    ).toThrow(TransitionError);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator/transitions.test.ts`
Expected: FAIL — module `../../src/orchestrator/transitions.js` not found

- [x] **Step 3: Implement transition engine**

```typescript
// src/orchestrator/transitions.ts
import { type JobState, ALLOWED_JOB_TRANSITIONS, isTerminalJob } from './job-state.js';
import { type RunState, ALLOWED_RUN_TRANSITIONS, isTerminalRun } from './run-state.js';
import { type AdvisorRunState, ALLOWED_ADVISOR_TRANSITIONS } from './run-state.js';
import type { Database } from '../db/database.js';

export class TransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
    public readonly from: string,
    public readonly to: string,
    public readonly reason: string,
  ) {
    super(`Transition ${entity} ${id}: ${from} -> ${to} rejected: ${reason}`);
    this.name = 'TransitionError';
  }
}

export interface JobTransitionRequest {
  jobId: string;
  expectedState: JobState;
  expectedVersion: number;
  newState: JobState;
  manualRetry?: boolean;
  idempotencyKey?: string;
  failureReason?: string;
}

export interface TransitionResult {
  success: boolean;
  newVersion: number;
  alreadyApplied?: boolean;
}

export function transitionJob(db: Database, req: JobTransitionRequest): TransitionResult {
  return db.transaction(() => {
    const row = db.get<{ id: string; state: JobState; version: number }>(
      'SELECT id, state, version FROM jobs WHERE id = ?',
      [req.jobId],
    );
    if (!row) {
      throw new TransitionError('job', req.jobId, req.expectedState, req.newState, 'job not found');
    }

    if (req.idempotencyKey && row.state === req.newState) {
      return { success: true, newVersion: row.version, alreadyApplied: true };
    }

    if (row.state !== req.expectedState) {
      throw new TransitionError('job', req.jobId, req.expectedState, req.newState,
        `current state is ${row.state}, expected ${req.expectedState}`);
    }
    if (row.version !== req.expectedVersion) {
      throw new TransitionError('job', req.jobId, req.expectedState, req.newState,
        `current version is ${row.version}, expected ${req.expectedVersion}`);
    }

    if (isTerminalJob(row.state)) {
      throw new TransitionError('job', req.jobId, row.state, req.newState,
        'terminal state is immutable');
    }

    if (row.state === 'failed' && req.newState === 'queued' && !req.manualRetry) {
      throw new TransitionError('job', req.jobId, row.state, req.newState,
        'failed -> queued requires explicit manualRetry');
    }

    const allowed = ALLOWED_JOB_TRANSITIONS.get(row.state);
    if (!allowed?.has(req.newState)) {
      throw new TransitionError('job', req.jobId, row.state, req.newState,
        'transition not in allowed graph');
    }

    const newVersion = row.version + 1;
    db.run(
      'UPDATE jobs SET state = ?, version = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND version = ?',
      [req.newState, newVersion, req.failureReason ?? null, new Date().toISOString(), req.jobId, row.version],
    );
    return { success: true, newVersion };
  });
}

export interface RunTransitionRequest {
  runId: string;
  expectedState: RunState;
  expectedVersion: number;
  newState: RunState;
}

export function transitionRun(db: Database, req: RunTransitionRequest): TransitionResult {
  return db.transaction(() => {
    const row = db.get<{ id: string; state: RunState; version: number }>(
      'SELECT id, state, version FROM runs WHERE id = ?',
      [req.runId],
    );
    if (!row) {
      throw new TransitionError('run', req.runId, req.expectedState, req.newState, 'run not found');
    }
    if (row.state !== req.expectedState || row.version !== req.expectedVersion) {
      throw new TransitionError('run', req.runId, req.expectedState, req.newState,
        `compare-and-set mismatch: state=${row.state} version=${row.version}`);
    }
    if (isTerminalRun(row.state)) {
      throw new TransitionError('run', req.runId, row.state, req.newState,
        'terminal state is immutable');
    }
    const allowed = ALLOWED_RUN_TRANSITIONS.get(row.state);
    if (!allowed?.has(req.newState)) {
      throw new TransitionError('run', req.runId, row.state, req.newState,
        'transition not in allowed graph');
    }
    const newVersion = row.version + 1;
    db.run(
      'UPDATE runs SET state = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      [req.newState, newVersion, new Date().toISOString(), req.runId, row.version],
    );
    return { success: true, newVersion };
  });
}

export interface AdvisorTransitionRequest {
  runId: string;
  expectedState: AdvisorRunState;
  expectedVersion: number;
  newState: AdvisorRunState;
}

export function transitionAdvisorRun(db: Database, req: AdvisorTransitionRequest): TransitionResult {
  return db.transaction(() => {
    const row = db.get<{ id: string; state: AdvisorRunState; version: number }>(
      'SELECT id, state, version FROM advisor_runs WHERE id = ?',
      [req.runId],
    );
    if (!row) {
      throw new TransitionError('advisor_run', req.runId, req.expectedState, req.newState, 'run not found');
    }
    if (row.state !== req.expectedState || row.version !== req.expectedVersion) {
      throw new TransitionError('advisor_run', req.runId, req.expectedState, req.newState,
        `compare-and-set mismatch: state=${row.state} version=${row.version}`);
    }
    const allowed = ALLOWED_ADVISOR_TRANSITIONS.get(row.state);
    if (!allowed?.has(req.newState)) {
      throw new TransitionError('advisor_run', req.runId, row.state, req.newState,
        'transition not in allowed graph');
    }
    const newVersion = row.version + 1;
    db.run(
      'UPDATE advisor_runs SET state = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      [req.newState, newVersion, new Date().toISOString(), req.runId, row.version],
    );
    return { success: true, newVersion };
  });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator/transitions.test.ts`
Expected: PASS (all 8 tests)

- [x] **Step 5: Commit**

```bash
git add src/orchestrator/transitions.ts tests/orchestrator/transitions.test.ts
git commit -m "feat(orchestrator): compare-and-set transition engine for job and run states"
```

---

## Task 3: Job Identity and Run Identity

**Files:**
- Create: `src/orchestrator/job-identity.ts`
- Create: `src/orchestrator/run-identity.ts`
- Test: `tests/orchestrator/job-identity.test.ts`

- [x] **Step 1: Write failing tests for job identity**

The critical invariant: **job identity excludes harness, model, context, and provenance hashes**. It is computed from pre-context facts only.

```typescript
// tests/orchestrator/job-identity.test.ts
import { describe, it, expect } from 'vitest';
import { computeJobIdentity, type JobIdentityInput } from '../../src/orchestrator/job-identity.js';
import { computeRunInputHash, computeRunId } from '../../src/orchestrator/run-identity.js';

const BASE_INPUT: JobIdentityInput = {
  role: 'primaryReview',
  repositoryKey: 'pba-webapp',
  prNumber: 42,
  headSha: 'a'.repeat(40),
  sourceMode: 'registered-source',
  policyDecisionHash: 'policy-hash-abc',
};

describe('computeJobIdentity', () => {
  it('produces a deterministic SHA-256 hex string', () => {
    const id1 = computeJobIdentity(BASE_INPUT);
    const id2 = computeJobIdentity(BASE_INPUT);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when repository changes', () => {
    const alt = computeJobIdentity({ ...BASE_INPUT, repositoryKey: 'pba-agents' });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it('changes when PR number changes', () => {
    const alt = computeJobIdentity({ ...BASE_INPUT, prNumber: 99 });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it('changes when head SHA changes', () => {
    const alt = computeJobIdentity({ ...BASE_INPUT, headSha: 'b'.repeat(40) });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it('changes when source mode changes', () => {
    const alt = computeJobIdentity({ ...BASE_INPUT, sourceMode: 'remote-evidence-only' });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it('changes when policy decision hash changes', () => {
    const alt = computeJobIdentity({ ...BASE_INPUT, policyDecisionHash: 'policy-hash-xyz' });
    expect(alt).not.toBe(computeJobIdentity(BASE_INPUT));
  });

  it('CRITICAL: is identical regardless of harness manifest hash', () => {
    const id = computeJobIdentity(BASE_INPUT);
    // Job identity has no harness/manifest input — same input always produces same output
    // regardless of what harness content exists.
    expect(id).toBe(computeJobIdentity(BASE_INPUT));
  });

  it('CRITICAL: job identity has exactly 5 domain inputs + role', () => {
    // Verify that changing only harness, model, or context hashes (which are NOT
    // inputs to job identity) does not change the job identity.
    // Since those are not even parameters, the type system enforces this.
    // This test documents the invariant: only role, repo, PR, head, sourceMode,
    // and policyDecisionHash are inputs.
    const id = computeJobIdentity(BASE_INPUT);
    expect(id).toBe(computeJobIdentity({ ...BASE_INPUT }));
  });
});

describe('computeRunInputHash', () => {
  it('changes when harness manifest hash changes', () => {
    const h1 = computeRunInputHash({
      harnessManifestHash: 'manifest-a',
      artifactSetHash: 'artifacts-a',
      sourceHash: 'source-a',
      provenanceCatalogHash: 'prov-a',
      modelSpecificationHash: 'model-a',
    });
    const h2 = computeRunInputHash({
      harnessManifestHash: 'manifest-b',
      artifactSetHash: 'artifacts-a',
      sourceHash: 'source-a',
      provenanceCatalogHash: 'prov-a',
      modelSpecificationHash: 'model-a',
    });
    expect(h1).not.toBe(h2);
  });

  it('changes when model specification hash changes', () => {
    const h1 = computeRunInputHash({
      harnessManifestHash: 'manifest-a',
      artifactSetHash: 'artifacts-a',
      sourceHash: 'source-a',
      provenanceCatalogHash: 'prov-a',
      modelSpecificationHash: 'model-a',
    });
    const h2 = computeRunInputHash({
      harnessManifestHash: 'manifest-a',
      artifactSetHash: 'artifacts-a',
      sourceHash: 'source-a',
      provenanceCatalogHash: 'prov-a',
      modelSpecificationHash: 'model-b',
    });
    expect(h1).not.toBe(h2);
  });
});

describe('computeRunId', () => {
  it('produces distinct IDs for different attempt numbers under same job', () => {
    const runId1 = computeRunId('job-abc', 'run-input-hash', 1);
    const runId2 = computeRunId('job-abc', 'run-input-hash', 2);
    expect(runId1).not.toBe(runId2);
    expect(runId1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = computeRunId('job-1', 'rih-1', 3);
    const b = computeRunId('job-1', 'rih-1', 3);
    expect(a).toBe(b);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator/job-identity.test.ts`
Expected: FAIL — modules not found

- [x] **Step 3: Implement job identity**

```typescript
// src/orchestrator/job-identity.ts
import { createHash } from 'node:crypto';

export interface JobIdentityInput {
  role: 'primaryReview';
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  sourceMode: 'registered-source' | 'remote-evidence-only';
  policyDecisionHash: string;
}

/**
 * Canonical hash over matcher version + eligibility/priority/auto-analysis/
 * domain reasons + the review-relevant policy subset (spec §10.5).
 * Uses plan 02's flat PolicyDecision — never a nested eligibility/priority object.
 */
export function computePolicyDecisionHash(input: {
  matcherVersion: string;
  decision: import('../policy/evaluate.js').PolicyDecision;
  reviewRelevantPolicySubset: unknown;
}): string {
  const { sha256OfCanonicalJson } = require('../util/hash.js') as {
    sha256OfCanonicalJson: (value: unknown) => string;
  };
  return sha256OfCanonicalJson({
    matcherVersion: input.matcherVersion,
    eligible: input.decision.eligible,
    eligibilityReasons: input.decision.eligibilityReasons,
    exclusionReasons: input.decision.exclusionReasons,
    priorityStatus: input.decision.priorityStatus,
    prioritySortOrdinal: input.decision.prioritySortOrdinal,
    selectedPriorityReason: input.decision.selectedPriorityReason,
    allPriorityReasons: input.decision.allPriorityReasons,
    analysisMode: input.decision.analysisMode,
    autoAnalyzeReasons: input.decision.autoAnalyzeReasons,
    selectedDomains: input.decision.selectedDomains,
    allDomainReasons: input.decision.allDomainReasons,
    reviewRelevantPolicySubset: input.reviewRelevantPolicySubset,
  });
}

export function computeJobIdentity(input: JobIdentityInput): string {
  const preimage = [
    `role=${input.role}`,
    `repo=${input.repositoryKey}`,
    `pr=${input.prNumber}`,
    `head=${input.headSha}`,
    `sourceMode=${input.sourceMode}`,
    `policyDecision=${input.policyDecisionHash}`,
  ].join('\n');

  return createHash('sha256').update(preimage).digest('hex');
}
```

- [x] **Step 4: Implement run identity**

```typescript
// src/orchestrator/run-identity.ts
import { createHash } from 'node:crypto';

export interface RunInputHashComponents {
  harnessManifestHash: string;
  artifactSetHash: string;
  sourceHash: string;
  provenanceCatalogHash: string;
  modelSpecificationHash: string;
}

export function computeRunInputHash(components: RunInputHashComponents): string {
  const preimage = [
    components.harnessManifestHash,
    components.artifactSetHash,
    components.sourceHash,
    components.provenanceCatalogHash,
    components.modelSpecificationHash,
  ].join('\n');

  return createHash('sha256').update(preimage).digest('hex');
}

export function computeRunId(
  jobId: string,
  runInputHash: string,
  attemptNumber: number,
): string {
  const preimage = `${jobId}\n${runInputHash}\n${attemptNumber}`;
  return createHash('sha256').update(preimage).digest('hex');
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator/job-identity.test.ts`
Expected: PASS (all 9 tests)

- [x] **Step 6: Commit**

```bash
git add src/orchestrator/job-identity.ts src/orchestrator/run-identity.ts tests/orchestrator/job-identity.test.ts
git commit -m "feat(orchestrator): job identity (pre-context only) and run-input hash derivation"
```

---

## Task 4: Restart Recovery

**Files:**
- Create: `src/orchestrator/recovery.ts`
- Test: `tests/orchestrator/recovery.test.ts`

- [x] **Step 1: Write failing tests for recovery logic**

```typescript
// tests/orchestrator/recovery.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recoverOrphanedStates, type RecoveryResult } from '../../src/orchestrator/recovery.js';
import type { Database } from '../../src/store/db.js';

interface MockRow {
  id: string;
  state: string;
  version: number;
  lease_expires_at?: number;
  [key: string]: unknown;
}

function createMockDb(
  jobs: MockRow[] = [],
  runs: MockRow[] = [],
  advisorRuns: MockRow[] = [],
): Database {
  return {
    run() { return { changes: 1, lastInsertRowid: 1 }; },
    get<T>(_sql: string, params?: unknown[]): T | undefined {
      const id = params?.[0] as string;
      const all = [...jobs, ...runs, ...advisorRuns];
      return all.find(r => r.id === id) as T | undefined;
    },
    all<T>(sql: string): T[] {
      if (sql.includes('jobs') && sql.includes('running_agent')) return jobs.filter(j => j.state === 'running_agent') as T[];
      if (sql.includes('jobs') && sql.includes('preparing')) return jobs.filter(j => j.state.startsWith('preparing')) as T[];
      if (sql.includes('jobs') && sql.includes('publishing')) return jobs.filter(j => j.state === 'publishing') as T[];
      if (sql.includes('runs') && sql.includes('running')) return runs.filter(r => r.state === 'running') as T[];
      if (sql.includes('advisor_runs') && sql.includes('running')) return advisorRuns.filter(r => r.state === 'running' || r.state === 'validating') as T[];
      return [];
    },
    transaction<T>(fn: () => T): T { return fn(); },
  };
}

describe('recoverOrphanedStates', () => {
  it('keeps queued jobs as queued', () => {
    const result = recoverOrphanedStates(createMockDb(
      [{ id: 'j1', state: 'queued', version: 1 }],
    ));
    expect(result.failedJobs).toHaveLength(0);
  });

  it('fails orphaned running_agent jobs with daemon_restart', () => {
    const result = recoverOrphanedStates(createMockDb(
      [{ id: 'j1', state: 'running_agent', version: 3 }],
    ));
    expect(result.failedJobs).toContain('j1');
    expect(result.failureReasons.get('j1')).toBe('daemon_restart');
  });

  it('fails orphaned running/validating runs', () => {
    const result = recoverOrphanedStates(createMockDb(
      [],
      [{ id: 'r1', state: 'running', version: 2 }],
    ));
    expect(result.failedRuns).toContain('r1');
  });

  it('fails orphaned advisor runs with daemon_restart', () => {
    const result = recoverOrphanedStates(createMockDb(
      [], [],
      [{ id: 'ar1', state: 'running', version: 1 }],
    ));
    expect(result.failedAdvisorRuns).toContain('ar1');
  });

  it('does not fail terminal jobs', () => {
    const result = recoverOrphanedStates(createMockDb(
      [{ id: 'j1', state: 'published', version: 5 }],
    ));
    expect(result.failedJobs).toHaveLength(0);
  });

  it('does not retry orphaned runs automatically', () => {
    const result = recoverOrphanedStates(createMockDb(
      [],
      [{ id: 'r1', state: 'running', version: 2 }],
    ));
    expect(result.autoRetried).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator/recovery.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement recovery**

```typescript
// src/orchestrator/recovery.ts
import type { Database } from '../db/database.js';

export interface RecoveryResult {
  failedJobs: string[];
  failedRuns: string[];
  failedAdvisorRuns: string[];
  autoRetried: string[];
  failureReasons: Map<string, string>;
  publishingReconciled: string[];
}

export function recoverOrphanedStates(db: Database): RecoveryResult {
  const result: RecoveryResult = {
    failedJobs: [],
    failedRuns: [],
    failedAdvisorRuns: [],
    autoRetried: [],
    failureReasons: new Map(),
    publishingReconciled: [],
  };

  db.transaction(() => {
    const now = new Date().toISOString();

    const orphanedAgentJobs = db.all<{ id: string; version: number }>(
      `SELECT id, version FROM jobs WHERE state = 'running_agent'`,
    );
    for (const job of orphanedAgentJobs) {
      db.run(
        `UPDATE jobs SET state = 'failed', version = version + 1, failure_reason = 'daemon_restart', updated_at = ? WHERE id = ? AND version = ?`,
        [now, job.id, job.version],
      );
      result.failedJobs.push(job.id);
      result.failureReasons.set(job.id, 'daemon_restart');
    }

    const orphanedValidatingJobs = db.all<{ id: string; version: number }>(
      `SELECT id, version FROM jobs WHERE state = 'validating_output'`,
    );
    for (const job of orphanedValidatingJobs) {
      db.run(
        `UPDATE jobs SET state = 'failed', version = version + 1, failure_reason = 'daemon_restart', updated_at = ? WHERE id = ? AND version = ?`,
        [now, job.id, job.version],
      );
      result.failedJobs.push(job.id);
      result.failureReasons.set(job.id, 'daemon_restart');
    }

    const orphanedRuns = db.all<{ id: string; version: number; state: string }>(
      `SELECT id, version, state FROM runs WHERE state IN ('running', 'validating')`,
    );
    for (const run of orphanedRuns) {
      db.run(
        `UPDATE runs SET state = 'failed', version = version + 1, failure_reason = 'daemon_restart', updated_at = ? WHERE id = ? AND version = ?`,
        [now, run.id, run.version],
      );
      result.failedRuns.push(run.id);
    }

    const orphanedAdvisorRuns = db.all<{ id: string; version: number; state: string }>(
      `SELECT id, version, state FROM advisor_runs WHERE state IN ('running', 'validating')`,
    );
    for (const run of orphanedAdvisorRuns) {
      db.run(
        `UPDATE advisor_runs SET state = 'failed', version = version + 1, failure_reason = 'daemon_restart', updated_at = ? WHERE id = ? AND version = ?`,
        [now, run.id, run.version],
      );
      result.failedAdvisorRuns.push(run.id);
    }

    const publishingJobs = db.all<{ id: string; version: number }>(
      `SELECT id, version FROM jobs WHERE state = 'publishing'`,
    );
    for (const job of publishingJobs) {
      const allOpsComplete = db.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM publication_operations WHERE job_id = ? AND status != 'completed'`,
        [job.id],
      );
      if (allOpsComplete && allOpsComplete.cnt === 0) {
        db.run(
          `UPDATE jobs SET state = 'published', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
          [now, job.id, job.version],
        );
        result.publishingReconciled.push(job.id);
      } else {
        db.run(
          `UPDATE jobs SET state = 'awaiting_approval', version = version + 1, failure_reason = 'daemon_restart_partial_publish', updated_at = ? WHERE id = ? AND version = ?`,
          [now, job.id, job.version],
        );
        result.failedJobs.push(job.id);
        result.failureReasons.set(job.id, 'daemon_restart_partial_publish');
      }
    }
  });

  return result;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator/recovery.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/orchestrator/recovery.ts tests/orchestrator/recovery.test.ts
git commit -m "feat(orchestrator): restart recovery for orphaned agent/advisor/publishing states"
```

---

## Task 5: Orchestrator Scheduler

**Files:**
- Create: `src/orchestrator/scheduler.ts`

- [x] **Step 1: Implement fair queue scheduler**

```typescript
// src/orchestrator/scheduler.ts
import type { Database } from '../db/database.js';

export interface SchedulerConfig {
  maxConcurrentAgents: number; // 1 or 2
  debounceMs: number;         // default 30_000
}

interface QueuedJob {
  id: string;
  repositoryKey: string;
  prNumber: number;
  prioritySortOrdinal: number;
  explicitRequestSort: number;
  queueTimestamp: string | null;
  normalizedRepositoryIdentity: string;
  identityHash: string;
  queuedAt: string;
}

export interface SchedulerDecision {
  jobsToStart: string[];
  reason: string;
}

export function selectNextJobs(
  db: Database,
  config: SchedulerConfig,
): SchedulerDecision {
  const activeCount = db.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM jobs WHERE state IN ('preparing_context','preparing_source','running_agent','validating_output')`,
  )?.cnt ?? 0;

  const slotsAvailable = Math.max(0, config.maxConcurrentAgents - activeCount);
  if (slotsAvailable === 0) {
    return { jobsToStart: [], reason: 'no_slots_available' };
  }

  const activePRs = new Set(
    db.all<{ identity_hash: string }>(
      `SELECT identity_hash FROM jobs WHERE state IN ('preparing_context','preparing_source','running_agent','validating_output')`,
    ).map(r => r.identity_hash),
  );

  const candidates = db.all<QueuedJob>(
    `SELECT id, repository_key as repositoryKey, pr_number as prNumber,
            priority_sort_ordinal as prioritySortOrdinal,
            explicit_request_sort as explicitRequestSort,
            queue_timestamp as queueTimestamp,
            normalized_repository_identity as normalizedRepositoryIdentity,
            identity_hash as identityHash,
            queued_at as queuedAt
     FROM jobs WHERE state = 'queued'
     ORDER BY priority_sort_ordinal ASC,
              explicit_request_sort ASC,
              queue_timestamp ASC NULLS LAST,
              normalized_repository_identity ASC,
              pr_number ASC`,
  );

  const now = Date.now();
  const jobsToStart: string[] = [];

  for (const candidate of candidates) {
    if (jobsToStart.length >= slotsAvailable) break;

    if (activePRs.has(candidate.identityHash)) continue;

    if (now - new Date(candidate.queuedAt).getTime() < config.debounceMs) continue;

    jobsToStart.push(candidate.id);
    activePRs.add(candidate.identityHash);
  }

  return {
    jobsToStart,
    reason: jobsToStart.length > 0 ? 'jobs_selected' : 'no_eligible_candidates',
  };
}
```

- [x] **Step 2: Commit**

```bash
git add src/orchestrator/scheduler.ts
git commit -m "feat(orchestrator): fair queue scheduler with concurrency limit and debounce"
```

---

## Task 6: Attention Candidate Selection

**Files:**
- Create: `src/attention/candidates.ts`
- Test: `tests/attention/candidates.test.ts`

- [x] **Step 1: Write failing tests for candidate selection**

Critical invariant: **advice never enqueues analysis**. Candidate selection uses the complete All Tracked tuple with eligible tiers preceding unranked.

```typescript
// tests/attention/candidates.test.ts
import { describe, it, expect } from 'vitest';
import {
  selectCandidates,
  type CandidateInput,
  type CandidateSelectionConfig,
} from '../../src/attention/candidates.js';

function makeItem(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 1,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    title: 'Test PR',
    author: 'test-user',
    draft: false,
    labels: [],
    additions: 10,
    deletions: 5,
    changedFiles: ['src/index.ts'],
    reviewRequested: true,
    checkSummary: [],
    updatedAt: '2026-07-10T00:00:00Z',
    bodyTruncated: '',
    prioritySortOrdinal: 3,
    explicitRequestSort: 1,
    queueTimestamp: '2026-07-10T00:00:00Z',
    normalizedRepositoryIdentity: 'github:github.com/org/pba-webapp',
    eligible: true,
    hasCurrentAdvice: false,
    adviceStale: false,
    previouslyFailed: false,
    previouslyNotScheduled: false,
    ...overrides,
  };
}

const DEFAULT_CONFIG: CandidateSelectionConfig = {
  maxCandidatesPerInvocation: 5,
};

describe('selectCandidates', () => {
  it('selects never-advised items first', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true }),
      makeItem({ prNumber: 2, hasCurrentAdvice: false }),
      makeItem({ prNumber: 3, hasCurrentAdvice: false }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected.map(c => c.prNumber)).toEqual([2, 3]);
  });

  it('selects stale/changed items', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, adviceStale: true }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, adviceStale: false }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected.map(c => c.prNumber)).toEqual([1]);
  });

  it('selects previously not_scheduled items', () => {
    const items = [
      makeItem({ prNumber: 1, previouslyNotScheduled: true }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected.map(c => c.prNumber)).toEqual([1]);
  });

  it('excludes failed exact identities from automatic selection', () => {
    const items = [
      makeItem({ prNumber: 1, previouslyFailed: true }),
    ];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    expect(selected).toHaveLength(0);
  });

  it('respects maxCandidatesPerInvocation bound', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ prNumber: i + 1, hasCurrentAdvice: false }),
    );
    const selected = selectCandidates(items, { maxCandidatesPerInvocation: 3 });
    expect(selected).toHaveLength(3);
  });

  it('eligible tiers precede unranked in selection order', () => {
    const items = [
      makeItem({ prNumber: 1, prioritySortOrdinal: 4, eligible: false, hasCurrentAdvice: false }),
      makeItem({ prNumber: 2, prioritySortOrdinal: 3, eligible: true, hasCurrentAdvice: false }),
      makeItem({ prNumber: 3, prioritySortOrdinal: 0, eligible: true, hasCurrentAdvice: false }),
    ];
    const selected = selectCandidates(items, { maxCandidatesPerInvocation: 2 });
    expect(selected.map(c => c.prNumber)).toEqual([3, 2]);
  });

  it('CRITICAL: advice cannot enqueue analysis — selection is metadata triage only', () => {
    const items = [makeItem({ prNumber: 1 })];
    const selected = selectCandidates(items, DEFAULT_CONFIG);
    for (const candidate of selected) {
      expect(candidate).not.toHaveProperty('enqueueAnalysis');
      expect(candidate).not.toHaveProperty('authorizeAnalysis');
    }
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/attention/candidates.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement candidate selection**

```typescript
// src/attention/candidates.ts

export interface CandidateInput {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: Array<{ name: string; status: string; conclusion: string | null }>;
  updatedAt: string | null;
  bodyTruncated: string;
  prioritySortOrdinal: number;
  explicitRequestSort: number;
  queueTimestamp: string | null;
  normalizedRepositoryIdentity: string;
  eligible: boolean;
  hasCurrentAdvice: boolean;
  adviceStale: boolean;
  previouslyFailed: boolean;
  previouslyNotScheduled: boolean;
}

export interface CandidateSelectionConfig {
  maxCandidatesPerInvocation: number;
}

export interface SelectedCandidate {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: Array<{ name: string; status: string; conclusion: string | null }>;
  updatedAt: string | null;
  bodyTruncated: string;
  selectionReason: 'never_advised' | 'stale_changed' | 'previously_not_scheduled';
}

export function selectCandidates(
  items: CandidateInput[],
  config: CandidateSelectionConfig,
): SelectedCandidate[] {
  const needsAdvice = items.filter(item => {
    if (item.previouslyFailed) return false;
    if (!item.hasCurrentAdvice) return true;
    if (item.adviceStale) return true;
    if (item.previouslyNotScheduled) return true;
    return false;
  });

  needsAdvice.sort((a, b) => {
    if (a.prioritySortOrdinal !== b.prioritySortOrdinal) return a.prioritySortOrdinal - b.prioritySortOrdinal;
    if (a.explicitRequestSort !== b.explicitRequestSort) return a.explicitRequestSort - b.explicitRequestSort;
    const aTs = a.queueTimestamp ?? '\uffff';
    const bTs = b.queueTimestamp ?? '\uffff';
    if (aTs !== bTs) return aTs < bTs ? -1 : 1;
    if (a.normalizedRepositoryIdentity !== b.normalizedRepositoryIdentity)
      return a.normalizedRepositoryIdentity < b.normalizedRepositoryIdentity ? -1 : 1;
    return a.prNumber - b.prNumber;
  });

  return needsAdvice.slice(0, config.maxCandidatesPerInvocation).map(item => ({
    repositoryKey: item.repositoryKey,
    prNumber: item.prNumber,
    headSha: item.headSha,
    baseSha: item.baseSha,
    title: item.title,
    author: item.author,
    draft: item.draft,
    labels: item.labels.slice(0, 50),
    additions: item.additions,
    deletions: item.deletions,
    changedFiles: item.changedFiles.slice(0, 500),
    reviewRequested: item.reviewRequested,
    checkSummary: item.checkSummary.slice(0, 100),
    updatedAt: item.updatedAt,
    bodyTruncated: item.bodyTruncated.slice(0, 8192),
    selectionReason: !item.hasCurrentAdvice
      ? 'never_advised'
      : item.adviceStale
        ? 'stale_changed'
        : 'previously_not_scheduled',
  }));
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/attention/candidates.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/attention/candidates.ts tests/attention/candidates.test.ts
git commit -m "feat(attention): deterministic candidate selection with eligibility ordering and bounds"
```

---

## Task 7: Per-PR Staleness Identity

**Files:**
- Create: `src/attention/staleness.ts`

- [x] **Step 1: Implement per-PR staleness identity**

```typescript
// src/attention/staleness.ts
import { createHash } from 'node:crypto';

export interface PerPrStalenessInput {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  metadataSnapshotHash: string;
  perPrPolicySubsetHash: string;
  attentionFeatureGuidanceHash: string; // layers 1, 3, 6, 8 only
  attentionModelSpecificationHash: string;
}

export function computePerPrStalenessIdentity(input: PerPrStalenessInput): string {
  const preimage = [
    `repo=${input.repositoryKey}`,
    `pr=${input.prNumber}`,
    `head=${input.headSha}`,
    `metaSnap=${input.metadataSnapshotHash}`,
    `policySubset=${input.perPrPolicySubsetHash}`,
    `guidance=${input.attentionFeatureGuidanceHash}`,
    `model=${input.attentionModelSpecificationHash}`,
  ].join('\n');

  return createHash('sha256').update(preimage).digest('hex');
}

export interface BatchStalenessInput {
  orderedCandidateMetadataSnapshotHash: string;
  relevantPolicyHash: string;
  completeAttentionManifestHash: string;
  attentionModelSpecificationHash: string;
}

export function computeBatchIdentity(input: BatchStalenessInput): string {
  const preimage = [
    `role=attention`,
    `candidates=${input.orderedCandidateMetadataSnapshotHash}`,
    `policy=${input.relevantPolicyHash}`,
    `manifest=${input.completeAttentionManifestHash}`,
    `model=${input.attentionModelSpecificationHash}`,
  ].join('\n');

  return createHash('sha256').update(preimage).digest('hex');
}

export function computeMetadataSnapshotHash(candidate: {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  changedFiles: string[];
  reviewRequested: boolean;
  checkSummary: Array<{ name: string; status: string; conclusion: string | null }>;
  bodyTruncated: string;
}): string {
  const canonical = JSON.stringify({
    author: candidate.author,
    bodyHash: createHash('sha256').update(candidate.bodyTruncated).digest('hex'),
    changedFiles: [...candidate.changedFiles].sort(),
    checkSummary: candidate.checkSummary.map(c => `${c.name}:${c.status}:${c.conclusion}`).sort(),
    draft: candidate.draft,
    headSha: candidate.headSha,
    labels: [...candidate.labels].sort(),
    prNumber: candidate.prNumber,
    repositoryKey: candidate.repositoryKey,
    reviewRequested: candidate.reviewRequested,
    title: candidate.title,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
```

- [x] **Step 2: Commit**

```bash
git add src/attention/staleness.ts
git commit -m "feat(attention): per-PR and batch staleness identity computation"
```

---

## Task 8: Advisor Order

**Files:**
- Create: `src/attention/advisor-order.ts`
- Test: `tests/attention/advisor-order.test.ts`

- [x] **Step 1: Write failing tests for advisor order**

```typescript
// tests/attention/advisor-order.test.ts
import { describe, it, expect } from 'vitest';
import { computeAdvisorOrder, type AdvisorOrderItem } from '../../src/attention/advisor-order.js';

function makeItem(overrides: Partial<AdvisorOrderItem> = {}): AdvisorOrderItem {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 1,
    hasCurrentAdvice: false,
    relevance: null,
    risk: null,
    prioritySortOrdinal: 3,
    explicitRequestSort: 1,
    queueTimestamp: '2026-07-10T00:00:00Z',
    normalizedRepositoryIdentity: 'github:github.com/org/pba-webapp',
    ...overrides,
  };
}

describe('computeAdvisorOrder', () => {
  it('items with current advice sort before items without', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: false }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'medium', risk: 'low' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted[0].prNumber).toBe(2);
    expect(sorted[1].prNumber).toBe(1);
  });

  it('sorts advised items by relevance ordinal then risk ordinal', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, relevance: 'low', risk: 'high' }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'critical', risk: 'medium' }),
      makeItem({ prNumber: 3, hasCurrentAdvice: true, relevance: 'high', risk: 'low' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted.map(i => i.prNumber)).toEqual([2, 3, 1]);
  });

  it('breaks relevance ties by risk ordinal', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, relevance: 'high', risk: 'low' }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'high', risk: 'critical' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted.map(i => i.prNumber)).toEqual([2, 1]);
  });

  it('falls back to deterministic queue tuple after risk tie', () => {
    const items = [
      makeItem({ prNumber: 5, hasCurrentAdvice: true, relevance: 'medium', risk: 'medium',
        prioritySortOrdinal: 2, normalizedRepositoryIdentity: 'github:github.com/org/z-repo' }),
      makeItem({ prNumber: 3, hasCurrentAdvice: true, relevance: 'medium', risk: 'medium',
        prioritySortOrdinal: 2, normalizedRepositoryIdentity: 'github:github.com/org/a-repo' }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted[0].prNumber).toBe(3); // a-repo before z-repo
  });

  it('non-advised items preserve deterministic relative order among themselves', () => {
    const items = [
      makeItem({ prNumber: 10, hasCurrentAdvice: false, prioritySortOrdinal: 1 }),
      makeItem({ prNumber: 5, hasCurrentAdvice: false, prioritySortOrdinal: 0 }),
    ];
    const sorted = computeAdvisorOrder(items);
    expect(sorted.map(i => i.prNumber)).toEqual([5, 10]);
  });

  it('CRITICAL: produces identical order regardless of batch partition history', () => {
    const items = [
      makeItem({ prNumber: 1, hasCurrentAdvice: true, relevance: 'high', risk: 'low' }),
      makeItem({ prNumber: 2, hasCurrentAdvice: true, relevance: 'critical', risk: 'medium' }),
      makeItem({ prNumber: 3, hasCurrentAdvice: false, prioritySortOrdinal: 0 }),
    ];
    const order1 = computeAdvisorOrder(items).map(i => i.prNumber);
    const order2 = computeAdvisorOrder([...items].reverse()).map(i => i.prNumber);
    expect(order1).toEqual(order2);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/attention/advisor-order.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement advisor order**

```typescript
// src/attention/advisor-order.ts

const RELEVANCE_ORDINAL: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

const RISK_ORDINAL: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

export interface AdvisorOrderItem {
  repositoryKey: string;
  prNumber: number;
  hasCurrentAdvice: boolean;
  relevance: string | null;
  risk: string | null;
  prioritySortOrdinal: number;
  explicitRequestSort: number;
  queueTimestamp: string | null;
  normalizedRepositoryIdentity: string;
}

function deterministicTupleCompare(a: AdvisorOrderItem, b: AdvisorOrderItem): number {
  if (a.prioritySortOrdinal !== b.prioritySortOrdinal)
    return a.prioritySortOrdinal - b.prioritySortOrdinal;
  if (a.explicitRequestSort !== b.explicitRequestSort)
    return a.explicitRequestSort - b.explicitRequestSort;
  const aTs = a.queueTimestamp ?? '\uffff';
  const bTs = b.queueTimestamp ?? '\uffff';
  if (aTs !== bTs) return aTs < bTs ? -1 : 1;
  if (a.normalizedRepositoryIdentity !== b.normalizedRepositoryIdentity)
    return a.normalizedRepositoryIdentity < b.normalizedRepositoryIdentity ? -1 : 1;
  return a.prNumber - b.prNumber;
}

export function computeAdvisorOrder(items: AdvisorOrderItem[]): AdvisorOrderItem[] {
  const advised = items.filter(i => i.hasCurrentAdvice);
  const nonAdvised = items.filter(i => !i.hasCurrentAdvice);

  advised.sort((a, b) => {
    const relA = RELEVANCE_ORDINAL[a.relevance ?? 'unknown'] ?? 4;
    const relB = RELEVANCE_ORDINAL[b.relevance ?? 'unknown'] ?? 4;
    if (relA !== relB) return relA - relB;

    const riskA = RISK_ORDINAL[a.risk ?? 'unknown'] ?? 4;
    const riskB = RISK_ORDINAL[b.risk ?? 'unknown'] ?? 4;
    if (riskA !== riskB) return riskA - riskB;

    return deterministicTupleCompare(a, b);
  });

  nonAdvised.sort(deterministicTupleCompare);

  return [...advised, ...nonAdvised];
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/attention/advisor-order.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/attention/advisor-order.ts tests/attention/advisor-order.test.ts
git commit -m "feat(attention): global advisor order with relevance/risk ordinals and deterministic tiebreak"
```

---

## Task 9: Attention Output Validation

**Files:**
- Create: `src/attention/validate-output.ts`
- Test: `tests/attention/validate-output.test.ts`

- [x] **Step 1: Write failing tests for attention output validation**

```typescript
// tests/attention/validate-output.test.ts
import { describe, it, expect } from 'vitest';
import {
  validateAttentionOutput,
  type AttentionOutputItem,
  type AttentionValidationInput,
} from '../../src/attention/validate-output.js';

function makeInput(candidates: Array<{ repositoryKey: string; prNumber: number; headSha: string }>): AttentionValidationInput {
  return { candidates };
}

function makeValidItem(repo: string, pr: number, head: string): AttentionOutputItem {
  return {
    repositoryKey: repo,
    prNumber: pr,
    headSha: head,
    relevance: 'medium',
    risk: 'low',
    explanation: 'Standard changes.',
    recommendedAction: 'analyze_on_demand',
    confidence: 'high',
    unknowns: [],
  };
}

describe('validateAttentionOutput', () => {
  it('accepts valid output matching all candidates', () => {
    const input = makeInput([
      { repositoryKey: 'pba-webapp', prNumber: 1, headSha: 'a'.repeat(40) },
    ]);
    const output = {
      schemaVersion: 1,
      items: [makeValidItem('pba-webapp', 1, 'a'.repeat(40))],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(true);
  });

  it('rejects when candidate is missing from output', () => {
    const input = makeInput([
      { repositoryKey: 'pba-webapp', prNumber: 1, headSha: 'a'.repeat(40) },
      { repositoryKey: 'pba-webapp', prNumber: 2, headSha: 'b'.repeat(40) },
    ]);
    const output = {
      schemaVersion: 1,
      items: [makeValidItem('pba-webapp', 1, 'a'.repeat(40))],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('missing output for candidate pba-webapp#2');
  });

  it('rejects extra items not in input candidates', () => {
    const input = makeInput([
      { repositoryKey: 'pba-webapp', prNumber: 1, headSha: 'a'.repeat(40) },
    ]);
    const output = {
      schemaVersion: 1,
      items: [
        makeValidItem('pba-webapp', 1, 'a'.repeat(40)),
        makeValidItem('pba-webapp', 99, 'c'.repeat(40)),
      ],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('extra'))).toBe(true);
  });

  it('rejects explanation over 1000 characters', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = makeValidItem('r', 1, 'a'.repeat(40));
    item.explanation = 'x'.repeat(1001);
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });

  it('rejects more than 10 unknowns', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = makeValidItem('r', 1, 'a'.repeat(40));
    item.unknowns = Array.from({ length: 11 }, (_, i) => `unknown-${i}`);
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });

  it('rejects mismatched headSha', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const output = {
      schemaVersion: 1,
      items: [makeValidItem('r', 1, 'b'.repeat(40))],
    };
    const result = validateAttentionOutput(output, input);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid relevance enum', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = makeValidItem('r', 1, 'a'.repeat(40));
    (item as { relevance: string }).relevance = 'super_critical';
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });

  it('rejects any numeric or batch-relative rank field', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = { ...makeValidItem('r', 1, 'a'.repeat(40)), rank: 1 };
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rank'))).toBe(true);
  });

  it('CRITICAL: advice output contains no analysis-enqueue field', () => {
    const input = makeInput([{ repositoryKey: 'r', prNumber: 1, headSha: 'a'.repeat(40) }]);
    const item = { ...makeValidItem('r', 1, 'a'.repeat(40)), enqueueAnalysis: true };
    const result = validateAttentionOutput({ schemaVersion: 1, items: [item] }, input);
    expect(result.valid).toBe(false);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/attention/validate-output.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement attention output validation**

```typescript
// src/attention/validate-output.ts

const VALID_RELEVANCE = new Set(['critical', 'high', 'medium', 'low', 'unknown']);
const VALID_RISK = new Set(['critical', 'high', 'medium', 'low', 'unknown']);
const VALID_ACTION = new Set(['analyze_now', 'analyze_on_demand', 'monitor', 'human_triage']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

const FORBIDDEN_KEYS = new Set([
  'rank', 'batchRank', 'position', 'order', 'priority',
  'enqueueAnalysis', 'authorizeAnalysis', 'autoAnalyze',
]);

export interface AttentionOutputItem {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  relevance: string;
  risk: string;
  explanation: string;
  recommendedAction: string;
  confidence: string;
  unknowns: string[];
  [key: string]: unknown;
}

export interface AttentionValidationInput {
  candidates: Array<{
    repositoryKey: string;
    prNumber: number;
    headSha: string;
  }>;
}

export interface AttentionValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAttentionOutput(
  output: { schemaVersion: number; items: AttentionOutputItem[] },
  input: AttentionValidationInput,
): AttentionValidationResult {
  const errors: string[] = [];

  if (output.schemaVersion !== 1) {
    errors.push(`invalid schemaVersion: expected 1, got ${output.schemaVersion}`);
  }

  if (!Array.isArray(output.items)) {
    errors.push('items must be an array');
    return { valid: false, errors };
  }

  const candidateKeys = new Set(
    input.candidates.map(c => `${c.repositoryKey}#${c.prNumber}#${c.headSha}`),
  );
  const outputKeys = new Set<string>();

  for (const item of output.items) {
    const key = `${item.repositoryKey}#${item.prNumber}#${item.headSha}`;

    for (const forbidden of FORBIDDEN_KEYS) {
      if (forbidden in item) {
        errors.push(`forbidden field '${forbidden}' in item ${item.repositoryKey}#${item.prNumber}`);
      }
    }

    if (!candidateKeys.has(key)) {
      errors.push(`extra item not in input candidates: ${item.repositoryKey}#${item.prNumber}`);
      continue;
    }
    if (outputKeys.has(key)) {
      errors.push(`duplicate item: ${item.repositoryKey}#${item.prNumber}`);
    }
    outputKeys.add(key);

    if (!VALID_RELEVANCE.has(item.relevance)) {
      errors.push(`invalid relevance '${item.relevance}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!VALID_RISK.has(item.risk)) {
      errors.push(`invalid risk '${item.risk}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!VALID_ACTION.has(item.recommendedAction)) {
      errors.push(`invalid recommendedAction '${item.recommendedAction}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!VALID_CONFIDENCE.has(item.confidence)) {
      errors.push(`invalid confidence '${item.confidence}' for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (typeof item.explanation !== 'string' || item.explanation.length > 1000) {
      errors.push(`explanation exceeds 1000 chars for ${item.repositoryKey}#${item.prNumber}`);
    }
    if (!Array.isArray(item.unknowns) || item.unknowns.length > 10) {
      errors.push(`unknowns exceeds 10 entries for ${item.repositoryKey}#${item.prNumber}`);
    }
  }

  for (const candidate of input.candidates) {
    const key = `${candidate.repositoryKey}#${candidate.prNumber}#${candidate.headSha}`;
    if (!outputKeys.has(key)) {
      errors.push(`missing output for candidate ${candidate.repositoryKey}#${candidate.prNumber}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/attention/validate-output.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/attention/validate-output.ts tests/attention/validate-output.test.ts
git commit -m "feat(attention): strict output schema validation with forbidden rank/enqueue fields"
```

---

## Task 10: Attention Run Orchestration

**Files:**
- Create: `src/attention/run.ts`

- [x] **Step 1: Implement attention run orchestration**

```typescript
// src/attention/run.ts
import type { SelectedCandidate } from './candidates.js';
import { computeBatchIdentity, type BatchStalenessInput } from './staleness.js';
import { validateAttentionOutput, type AttentionValidationInput } from './validate-output.js';
import type { Database } from '../db/database.js';

export interface AttentionRunConfig {
  timeoutMs: number; // default 90_000
  attentionModelSpecification: { modelId: string; hash: string };
}

export interface AttentionRunInput {
  candidates: SelectedCandidate[];
  batchIdentity: BatchStalenessInput;
  manifestHash: string;
  policySnapshotHash: string;
}

export interface AttentionRunResult {
  runId: string;
  batchIdentityHash: string;
  success: boolean;
  validationResult?: { valid: boolean; errors: string[] };
  failureReason?: string;
}

export function buildAttentionRunDirectory(runId: string, dataDir: string): string {
  return `${dataDir}/attention-runs/${runId}`;
}

export function buildAttentionCandidateMetadata(candidates: SelectedCandidate[]): object[] {
  return candidates.map(c => ({
    repositoryKey: c.repositoryKey,
    prNumber: c.prNumber,
    headSha: c.headSha,
    baseSha: c.baseSha,
    title: c.title,
    author: c.author,
    draft: c.draft,
    labels: c.labels,
    additions: c.additions,
    deletions: c.deletions,
    changedFiles: c.changedFiles,
    reviewRequested: c.reviewRequested,
    checkSummary: c.checkSummary,
    updatedAt: c.updatedAt,
    bodyTruncated: c.bodyTruncated,
  }));
}

export function validateAttentionRunResult(
  rawOutput: unknown,
  candidates: SelectedCandidate[],
): { valid: boolean; errors: string[]; parsed?: { schemaVersion: number; items: unknown[] } } {
  if (typeof rawOutput !== 'object' || rawOutput === null) {
    return { valid: false, errors: ['output is not an object'] };
  }

  const output = rawOutput as Record<string, unknown>;
  const input: AttentionValidationInput = {
    candidates: candidates.map(c => ({
      repositoryKey: c.repositoryKey,
      prNumber: c.prNumber,
      headSha: c.headSha,
    })),
  };

  return validateAttentionOutput(output as Parameters<typeof validateAttentionOutput>[0], input);
}
```

- [x] **Step 2: Commit**

```bash
git add src/attention/run.ts
git commit -m "feat(attention): run orchestration with metadata-only directory and validation"
```

---

## Task 11: Authenticated Fetch Boundary

**Files:**
- Create: `src/source/fetch-boundary.ts`
- Test: `tests/source/fetch-boundary.test.ts`

- [x] **Step 1: Write failing tests for fetch boundary credential isolation**

Critical invariant: **fetch env has SSH_AUTH_SOCK; materialize env does not**.

```typescript
// tests/source/fetch-boundary.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildFetchEnvironment,
  buildVerifyEnvironment,
  buildMirrorPath,
  type FetchBoundaryConfig,
} from '../../src/source/fetch-boundary.js';

const BASE_CONFIG: FetchBoundaryConfig = {
  dataDirectory: '/data',
  sshAuthSock: '/tmp/ssh-agent.sock',
  catalogRemote: 'git@github.com:org/pba-webapp.git',
  catalogRefspec: '+refs/pull/42/head:refs/ct/pr/42',
  homePath: '/Users/test',
};

describe('buildFetchEnvironment', () => {
  it('includes SSH_AUTH_SOCK for authenticated fetch', () => {
    const env = buildFetchEnvironment(BASE_CONFIG);
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/ssh-agent.sock');
  });

  it('includes only common safe variables plus SSH', () => {
    const env = buildFetchEnvironment(BASE_CONFIG);
    expect(env).toHaveProperty('PATH');
    expect(env).toHaveProperty('HOME');
    expect(env).toHaveProperty('SSH_AUTH_SOCK');
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env).not.toHaveProperty('CURSOR_API_KEY');
    expect(env).not.toHaveProperty('GIT_ASKPASS');
  });

  it('removes GIT_ASKPASS and SSH_ASKPASS', () => {
    const env = buildFetchEnvironment(BASE_CONFIG);
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.SSH_ASKPASS).toBeUndefined();
  });
});

describe('buildVerifyEnvironment', () => {
  it('CRITICAL: has NO SSH_AUTH_SOCK', () => {
    const env = buildVerifyEnvironment(BASE_CONFIG);
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
  });

  it('has NO credential helper access', () => {
    const env = buildVerifyEnvironment(BASE_CONFIG);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
  });

  it('disables network protocols', () => {
    const env = buildVerifyEnvironment(BASE_CONFIG);
    expect(env).not.toHaveProperty('SSH_AUTH_SOCK');
    expect(env).not.toHaveProperty('GH_TOKEN');
  });
});

describe('buildMirrorPath', () => {
  it('computes canonical mirror path under data directory', () => {
    const path = buildMirrorPath('/data', 'org', 'pba-webapp');
    expect(path).toBe('/data/mirrors/org/pba-webapp.git');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/source/fetch-boundary.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement fetch boundary**

```typescript
// src/source/fetch-boundary.ts

export interface FetchBoundaryConfig {
  dataDirectory: string;
  sshAuthSock: string | undefined;
  catalogRemote: string;
  catalogRefspec: string;
  homePath: string;
}

function commonEnvBase(homePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  env.HOME = homePath;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
  if (process.env.USER) env.USER = process.env.USER;
  return env;
}

export function buildFetchEnvironment(config: FetchBoundaryConfig): Record<string, string> {
  const env = commonEnvBase(config.homePath);
  if (config.sshAuthSock) {
    env.SSH_AUTH_SOCK = config.sshAuthSock;
  }
  return env;
}

export function buildVerifyEnvironment(config: FetchBoundaryConfig): Record<string, string> {
  const env = commonEnvBase(config.homePath);
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_ATTR_NOSYSTEM = '1';
  return env;
}

export function buildFetchArgs(config: FetchBoundaryConfig, mirrorPath: string): string[] {
  return [
    'fetch',
    '--no-tags',
    '--no-recurse-submodules',
    config.catalogRemote,
    config.catalogRefspec,
  ];
}

export function buildMirrorPath(dataDirectory: string, owner: string, repo: string): string {
  return `${dataDirectory}/mirrors/${owner}/${repo}.git`;
}

export function buildVerifyArgs(expectedSha: string, ctRef: string): string[] {
  return ['rev-parse', '--verify', ctRef];
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/source/fetch-boundary.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/source/fetch-boundary.ts tests/source/fetch-boundary.test.ts
git commit -m "feat(source): authenticated fetch boundary with SSH isolation and credential-free verify"
```

---

## Task 12: Credential-Free Source Materialization and Cleanup

**Files:**
- Create: `src/source/materialize.ts`
- Create: `src/source/cleanup.ts`
- Test: `tests/source/materialize.test.ts`

- [x] **Step 1: Write failing tests for materialization environment**

Critical invariant: **materialize env has NO SSH, NO credential helper, NO network**.

```typescript
// tests/source/materialize.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildMaterializeEnvironment,
  buildAdminWorktreeArgs,
  filterTreeEntry,
  buildSourceManifest,
  type TreeEntry,
  type MaterializeConfig,
} from '../../src/source/materialize.js';

const BASE_CONFIG: MaterializeConfig = {
  homePath: '/Users/test',
  mirrorPath: '/data/mirrors/org/repo.git',
  jobId: 'job-123',
  dataDirectory: '/data',
  pathMatcherVersion: 'v1',
  protectedPatternSetHash: 'pphash-abc',
};

describe('buildMaterializeEnvironment', () => {
  it('CRITICAL: has NO SSH_AUTH_SOCK', () => {
    const env = buildMaterializeEnvironment(BASE_CONFIG);
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
    expect(env).not.toHaveProperty('SSH_AUTH_SOCK');
  });

  it('CRITICAL: has NO credential helpers', () => {
    const env = buildMaterializeEnvironment(BASE_CONFIG);
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env).not.toHaveProperty('GIT_ASKPASS');
    expect(env).not.toHaveProperty('SSH_ASKPASS');
  });

  it('disables system/global config', () => {
    const env = buildMaterializeEnvironment(BASE_CONFIG);
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(env.GIT_ATTR_NOSYSTEM).toBe('1');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });
});

describe('buildAdminWorktreeArgs', () => {
  it('uses --detach --no-checkout', () => {
    const args = buildAdminWorktreeArgs('/data/worktrees/job-123/admin');
    expect(args).toContain('--detach');
    expect(args).toContain('--no-checkout');
    expect(args).not.toContain('checkout');
  });
});

describe('filterTreeEntry', () => {
  const protectedMatcher = { matches: (p: string) => p.startsWith('.env'), canonicalize: (p: string) => p, version: 'v1', contentHash: 'h' };

  it('accepts regular blob mode 100644', () => {
    const entry: TreeEntry = { mode: '100644', type: 'blob', sha: 'abc', path: 'src/index.ts' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(true);
  });

  it('accepts executable blob mode 100755', () => {
    const entry: TreeEntry = { mode: '100755', type: 'blob', sha: 'abc', path: 'scripts/build.sh' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(true);
  });

  it('rejects symlinks', () => {
    const entry: TreeEntry = { mode: '120000', type: 'blob', sha: 'abc', path: 'link' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('symlink');
  });

  it('rejects gitlinks/submodules', () => {
    const entry: TreeEntry = { mode: '160000', type: 'commit', sha: 'abc', path: 'vendor/lib' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('submodule');
  });

  it('rejects protected paths and retains only path + reason', () => {
    const entry: TreeEntry = { mode: '100644', type: 'blob', sha: 'abc', path: '.env.local' };
    const result = filterTreeEntry(entry, protectedMatcher);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('protected_path_content');
    expect(result).not.toHaveProperty('blobSha');
  });
});

describe('buildSourceManifest', () => {
  it('records allowed entries with path, sha, size, mode', () => {
    const allowed = [
      { path: 'src/a.ts', blobSha: 'sha-a', size: 100, mode: '100644' },
    ];
    const omitted = [
      { path: '.env', reason: 'protected_path_content' },
    ];
    const manifest = buildSourceManifest({
      repositoryId: 'pba-webapp',
      headCommit: 'commit-sha',
      rootTreeSha: 'tree-sha',
      matcherVersion: 'v1',
      protectedPatternSetHash: 'pphash',
      allowed,
      omitted,
    });
    expect(manifest.allowed).toHaveLength(1);
    expect(manifest.omitted).toHaveLength(1);
    expect(manifest.omitted[0]).not.toHaveProperty('blobSha');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/source/materialize.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement materialization**

```typescript
// src/source/materialize.ts
import { createHash } from 'node:crypto';

export interface MaterializeConfig {
  homePath: string;
  mirrorPath: string;
  jobId: string;
  dataDirectory: string;
  pathMatcherVersion: string;
  protectedPatternSetHash: string;
}

export interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  path: string;
}

export interface FilterResult {
  accepted: boolean;
  reason?: string;
  path: string;
  blobSha?: string;
}

interface PathMatcher {
  matches(path: string): boolean;
  canonicalize(path: string): string | null;
  version: string;
  contentHash: string;
}

const ALLOWED_MODES = new Set(['100644', '100755']);

export function buildMaterializeEnvironment(config: MaterializeConfig): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  env.HOME = config.homePath;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.USER) env.USER = process.env.USER;

  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_ATTR_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';

  return env;
}

export function buildMaterializeGitArgs(): string[] {
  return [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.attributesFile=/dev/null',
    '-c', 'credential.helper=',
    '-c', 'protocol.allow=never',
    '-c', 'submodule.recurse=false',
  ];
}

export function buildAdminWorktreeArgs(adminPath: string): string[] {
  return ['worktree', 'add', '--detach', '--no-checkout', adminPath];
}

export function filterTreeEntry(entry: TreeEntry, protectedMatcher: PathMatcher): FilterResult {
  const canonical = protectedMatcher.canonicalize(entry.path);
  if (canonical === null) {
    return { accepted: false, reason: 'unsafe_path', path: entry.path };
  }

  if (entry.mode === '120000') {
    return { accepted: false, reason: 'symlink', path: canonical };
  }
  if (entry.mode === '160000') {
    return { accepted: false, reason: 'submodule', path: canonical };
  }
  if (!ALLOWED_MODES.has(entry.mode)) {
    return { accepted: false, reason: 'unsupported_mode', path: canonical };
  }

  if (protectedMatcher.matches(canonical)) {
    return { accepted: false, reason: 'protected_path_content', path: canonical };
  }

  return { accepted: true, path: canonical, blobSha: entry.sha };
}

export interface SourceManifestInput {
  repositoryId: string;
  headCommit: string;
  rootTreeSha: string;
  matcherVersion: string;
  protectedPatternSetHash: string;
  allowed: Array<{ path: string; blobSha: string; size: number; mode: string }>;
  omitted: Array<{ path: string; reason: string }>;
}

export interface SourceManifest {
  repositoryId: string;
  headCommit: string;
  rootTreeSha: string;
  matcherVersion: string;
  protectedPatternSetHash: string;
  contentHash: string;
  allowed: Array<{ path: string; blobSha: string; size: number; mode: string }>;
  omitted: Array<{ path: string; reason: string }>;
}

export function buildSourceManifest(input: SourceManifestInput): SourceManifest {
  const hashInput = JSON.stringify({
    allowed: input.allowed.map(a => `${a.path}:${a.blobSha}:${a.size}:${a.mode}`).sort(),
    headCommit: input.headCommit,
    matcherVersion: input.matcherVersion,
    omitted: input.omitted.map(o => `${o.path}:${o.reason}`).sort(),
    protectedPatternSetHash: input.protectedPatternSetHash,
    repositoryId: input.repositoryId,
    rootTreeSha: input.rootTreeSha,
  });

  return {
    ...input,
    contentHash: createHash('sha256').update(hashInput).digest('hex'),
  };
}

export function worktreeAdminPath(dataDirectory: string, jobId: string): string {
  return `${dataDirectory}/worktrees/${jobId}/admin`;
}

export function worktreeSourcePath(dataDirectory: string, jobId: string): string {
  return `${dataDirectory}/worktrees/${jobId}/source`;
}
```

- [x] **Step 4: Implement cleanup**

```typescript
// src/source/cleanup.ts
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface CleanupConfig {
  dataDirectory: string;
  maxMaterialized: number;    // default 4
  maxStorageBytes: number;    // default 10 * 1024 * 1024 * 1024 (10 GB)
}

export interface CleanupResult {
  removedPairs: string[];
  removedMirrors: string[];
}

export async function removeRunSourcePair(
  dataDirectory: string,
  jobId: string,
): Promise<void> {
  const adminPath = join(dataDirectory, 'worktrees', jobId, 'admin');
  const sourcePath = join(dataDirectory, 'worktrees', jobId, 'source');

  await fs.rm(sourcePath, { recursive: true, force: true });
  await fs.rm(adminPath, { recursive: true, force: true });

  const jobWorktreeDir = join(dataDirectory, 'worktrees', jobId);
  try {
    const remaining = await fs.readdir(jobWorktreeDir);
    if (remaining.length === 0) {
      await fs.rmdir(jobWorktreeDir);
    }
  } catch {
    // directory already gone
  }
}

export async function cleanupAbandonedPairs(
  dataDirectory: string,
  activeJobIds: Set<string>,
): Promise<CleanupResult> {
  const result: CleanupResult = { removedPairs: [], removedMirrors: [] };
  const worktreesDir = join(dataDirectory, 'worktrees');

  try {
    const entries = await fs.readdir(worktreesDir);
    for (const entry of entries) {
      if (!activeJobIds.has(entry)) {
        await fs.rm(join(worktreesDir, entry), { recursive: true, force: true });
        result.removedPairs.push(entry);
      }
    }
  } catch {
    // worktrees directory may not exist yet
  }

  return result;
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/source/materialize.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/source/materialize.ts src/source/cleanup.ts tests/source/materialize.test.ts
git commit -m "feat(source): credential-free materialization with protected-path filtering and cleanup"
```

---

## Task 13: Remote-Evidence-Only Path

**Files:**
- Create: `src/source/remote-evidence.ts`
- Test: `tests/source/remote-evidence.test.ts`

- [x] **Step 1: Write failing tests for remote-evidence-only**

Critical invariant: **remote-evidence-only produces no `--add-dir`, no file provenance, no mirror, no source view**.

```typescript
// tests/source/remote-evidence.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildRemoteEvidenceCoverage,
  isRemoteEvidenceOnly,
  type RemoteEvidenceResult,
} from '../../src/source/remote-evidence.js';

describe('buildRemoteEvidenceCoverage', () => {
  it('sets sourceTreeInspected to false', () => {
    const coverage = buildRemoteEvidenceCoverage([]);
    expect(coverage.sourceTreeInspected).toBe(false);
  });

  it('includes source_tree in missingCoverage', () => {
    const coverage = buildRemoteEvidenceCoverage([]);
    expect(coverage.missingCoverage).toContain('source_tree');
  });

  it('CRITICAL: produces no source manifest', () => {
    const coverage = buildRemoteEvidenceCoverage([]);
    expect(coverage).not.toHaveProperty('sourceManifest');
  });

  it('records protected path omissions by name only', () => {
    const coverage = buildRemoteEvidenceCoverage([
      { path: '.env', reason: 'protected_path_content' },
    ]);
    expect(coverage.omittedProtectedPaths).toEqual([
      { path: '.env', reason: 'protected_path_content' },
    ]);
  });
});

describe('isRemoteEvidenceOnly', () => {
  it('returns true for unregistered repositories', () => {
    expect(isRemoteEvidenceOnly({ registered: false, active: false, doctorPassed: false })).toBe(true);
  });

  it('returns true for inactive repositories', () => {
    expect(isRemoteEvidenceOnly({ registered: true, active: false, doctorPassed: true })).toBe(true);
  });

  it('returns false for registered, active, doctor-passed repositories', () => {
    expect(isRemoteEvidenceOnly({ registered: true, active: true, doctorPassed: true })).toBe(false);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/source/remote-evidence.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement remote-evidence-only path**

```typescript
// src/source/remote-evidence.ts
import type { CoverageObject } from '../context/coverage.js';

export interface ProtectedOmission {
  path: string;
  reason: string;
}

export interface RemoteEvidenceResult {
  sourceTreeInspected: false;
  missingCoverage: string[];
  omittedProtectedPaths: ProtectedOmission[];
  omittedSourceEntries: string[];
}

export function buildRemoteEvidenceCoverage(
  protectedOmissions: ProtectedOmission[],
): RemoteEvidenceResult {
  return {
    sourceTreeInspected: false,
    missingCoverage: ['source_tree'],
    omittedProtectedPaths: protectedOmissions,
    omittedSourceEntries: [],
  };
}

export function isRemoteEvidenceOnly(repo: {
  registered: boolean;
  active: boolean;
  doctorPassed: boolean;
}): boolean {
  return !(repo.registered && repo.active && repo.doctorPassed);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/source/remote-evidence.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/source/remote-evidence.ts tests/source/remote-evidence.test.ts
git commit -m "feat(source): remote-evidence-only path with missing source-tree coverage"
```

---

## Task 14: Nine-Layer Harness Manifest

**Files:**
- Create: `src/context/harness-manifest.ts`
- Test: `tests/context/harness-manifest.test.ts`

- [x] **Step 1: Write failing tests for harness manifest**

Critical invariant: **manifest layers 4, 5, and 7 are empty for attention**.

```typescript
// tests/context/harness-manifest.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildHarnessManifest,
  type ManifestEntry,
  type ManifestBuildInput,
} from '../../src/context/harness-manifest.js';

function makeReviewInput(): ManifestBuildInput {
  return {
    role: 'primaryReview',
    safetyContract: { content: 'safety rules', hash: 'safety-hash', bytes: 12 },
    outputContract: { content: 'output schema', hash: 'output-hash', bytes: 13 },
    policySnapshot: { content: '{}', hash: 'policy-hash', bytes: 2 },
    orgFeaturePrompt: { content: 'org prompt', hash: 'org-prompt-hash', bytes: 10 },
    orgFeatureSkill: { content: 'org skill', hash: 'org-skill-hash', bytes: 9 },
    orgDomainGuidance: [
      { domain: 'backend', content: 'backend guidance', hash: 'backend-hash', bytes: 16 },
    ],
    repositoryGuidance: { content: 'repo guidance', hash: 'repo-hash', bytes: 13 },
    engineerFeaturePrompt: { content: 'eng prompt', hash: 'eng-prompt-hash', bytes: 10 },
    engineerFeatureSkill: { content: 'eng skill', hash: 'eng-skill-hash', bytes: 9 },
    engineerDomainGuidance: [
      { domain: 'backend', content: 'eng backend', hash: 'eng-backend-hash', bytes: 11 },
    ],
    persona: { content: 'persona', hash: 'persona-hash', bytes: 7 },
    prInputs: [{ logicalPath: 'pr.json', hash: 'pr-hash', bytes: 100 }],
    provenanceCatalog: { logicalPath: 'provenance-catalog.json', hash: 'prov-hash', bytes: 200 },
  };
}

function makeAttentionInput(): ManifestBuildInput {
  return {
    role: 'attention',
    safetyContract: { content: 'safety rules', hash: 'safety-hash', bytes: 12 },
    outputContract: { content: 'output schema', hash: 'output-hash', bytes: 13 },
    policySnapshot: { content: '{}', hash: 'policy-hash', bytes: 2 },
    orgFeaturePrompt: { content: 'org prompt', hash: 'org-prompt-hash', bytes: 10 },
    orgFeatureSkill: null,
    orgDomainGuidance: [],
    repositoryGuidance: null,
    engineerFeaturePrompt: { content: 'eng prompt', hash: 'eng-prompt-hash', bytes: 10 },
    engineerFeatureSkill: null,
    engineerDomainGuidance: [],
    persona: { content: 'persona', hash: 'persona-hash', bytes: 7 },
    prInputs: [{ logicalPath: 'candidates.json', hash: 'cand-hash', bytes: 500 }],
    provenanceCatalog: null,
  };
}

describe('buildHarnessManifest', () => {
  it('assigns nine layers with correct ordinals for primaryReview', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layers = new Set(manifest.entries.map(e => e.layerOrdinal));
    expect(layers).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  it('layer 1 contains safety contract then output contract', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer1 = manifest.entries.filter(e => e.layerOrdinal === 1);
    expect(layer1).toHaveLength(2);
    expect(layer1[0].logicalPath).toContain('safety');
    expect(layer1[1].logicalPath).toContain('output');
    expect(layer1[0].entryOrdinal).toBeLessThan(layer1[1].entryOrdinal);
  });

  it('layer 2 contains only policy.snapshot.json', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer2 = manifest.entries.filter(e => e.layerOrdinal === 2);
    expect(layer2).toHaveLength(1);
    expect(layer2[0].logicalPath).toBe('policy.snapshot.json');
  });

  it('CRITICAL: layers 4, 5, and 7 are empty for attention role', () => {
    const manifest = buildHarnessManifest(makeAttentionInput());
    const layer4 = manifest.entries.filter(e => e.layerOrdinal === 4);
    const layer5 = manifest.entries.filter(e => e.layerOrdinal === 5);
    const layer7 = manifest.entries.filter(e => e.layerOrdinal === 7);
    expect(layer4).toHaveLength(0);
    expect(layer5).toHaveLength(0);
    expect(layer7).toHaveLength(0);
  });

  it('attention manifest has no provenance catalog in layer 9', () => {
    const manifest = buildHarnessManifest(makeAttentionInput());
    const layer9 = manifest.entries.filter(e => e.layerOrdinal === 9);
    expect(layer9.every(e => !e.logicalPath.includes('provenance'))).toBe(true);
  });

  it('primaryReview layer 9 ends with provenance catalog', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer9 = manifest.entries.filter(e => e.layerOrdinal === 9);
    const last = layer9[layer9.length - 1];
    expect(last.logicalPath).toBe('provenance-catalog.json');
  });

  it('every entry has a globally unique entryOrdinal', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const ordinals = manifest.entries.map(e => e.entryOrdinal);
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it('no entry appears in more than one layer', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const pathToLayers = new Map<string, number[]>();
    for (const entry of manifest.entries) {
      const layers = pathToLayers.get(entry.logicalPath) ?? [];
      layers.push(entry.layerOrdinal);
      pathToLayers.set(entry.logicalPath, layers);
    }
    for (const [path, layers] of pathToLayers) {
      expect(layers.length, `${path} appears in multiple layers`).toBe(1);
    }
  });

  it('manifest hash changes when any entry content hash changes', () => {
    const input1 = makeReviewInput();
    const input2 = makeReviewInput();
    input2.persona = { content: 'different', hash: 'different-hash', bytes: 9 };
    const m1 = buildHarnessManifest(input1);
    const m2 = buildHarnessManifest(input2);
    expect(m1.manifestHash).not.toBe(m2.manifestHash);
  });

  it('feature prompts precede their skill within layers 3 and 6', () => {
    const manifest = buildHarnessManifest(makeReviewInput());
    const layer3 = manifest.entries.filter(e => e.layerOrdinal === 3);
    const promptIdx = layer3.findIndex(e => e.logicalPath.includes('prompt'));
    const skillIdx = layer3.findIndex(e => e.logicalPath.includes('skill'));
    expect(promptIdx).toBeLessThan(skillIdx);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/context/harness-manifest.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement harness manifest builder**

```typescript
// src/context/harness-manifest.ts
import { createHash } from 'node:crypto';

export interface ArtifactRef {
  content: string;
  hash: string;
  bytes: number;
}

export interface DomainArtifact {
  domain: string;
  content: string;
  hash: string;
  bytes: number;
}

export interface InputArtifact {
  logicalPath: string;
  hash: string;
  bytes: number;
}

export interface ManifestBuildInput {
  role: 'primaryReview' | 'attention';
  safetyContract: ArtifactRef;
  outputContract: ArtifactRef;
  policySnapshot: ArtifactRef;
  orgFeaturePrompt: ArtifactRef | null;
  orgFeatureSkill: ArtifactRef | null;
  orgDomainGuidance: DomainArtifact[];
  repositoryGuidance: ArtifactRef | null;
  engineerFeaturePrompt: ArtifactRef | null;
  engineerFeatureSkill: ArtifactRef | null;
  engineerDomainGuidance: DomainArtifact[];
  persona: ArtifactRef | null;
  prInputs: InputArtifact[];
  provenanceCatalog: InputArtifact | null;
}

export interface ManifestEntry {
  layerOrdinal: number;
  layerName: string;
  entryOrdinal: number;
  feature: string;
  domain: string | null;
  logicalPath: string;
  contentHash: string;
  byteLength: number;
}

export interface HarnessManifest {
  entries: ManifestEntry[];
  manifestHash: string;
}

export function buildHarnessManifest(input: ManifestBuildInput): HarnessManifest {
  const entries: ManifestEntry[] = [];
  let ordinal = 0;

  function add(layer: number, layerName: string, logicalPath: string, hash: string, bytes: number, feature: string, domain: string | null) {
    entries.push({
      layerOrdinal: layer,
      layerName,
      entryOrdinal: ordinal++,
      feature,
      domain,
      logicalPath,
      contentHash: hash,
      byteLength: bytes,
    });
  }

  const feature = input.role === 'primaryReview' ? 'pr-review' : 'pr-attention';

  // Layer 1: safety contract + output contract
  add(1, 'application_safety', 'safety-contract.md', input.safetyContract.hash, input.safetyContract.bytes, feature, null);
  add(1, 'application_safety', 'output-contract.md', input.outputContract.hash, input.outputContract.bytes, feature, null);

  // Layer 2: policy snapshot only
  add(2, 'policy_snapshot', 'policy.snapshot.json', input.policySnapshot.hash, input.policySnapshot.bytes, feature, null);

  // Layer 3: org feature guidance
  if (input.orgFeaturePrompt) {
    add(3, 'org_feature_guidance', `harnesses/${feature}/prompt.md`, input.orgFeaturePrompt.hash, input.orgFeaturePrompt.bytes, feature, null);
  }
  if (input.orgFeatureSkill) {
    add(3, 'org_feature_guidance', `harnesses/${feature}/skills/skill/SKILL.md`, input.orgFeatureSkill.hash, input.orgFeatureSkill.bytes, feature, null);
  }

  // Layer 4: org domain guidance (empty for attention)
  if (input.role === 'primaryReview') {
    for (const dg of input.orgDomainGuidance) {
      add(4, 'org_domain_guidance', `harnesses/pr-review/domains/${dg.domain}.md`, dg.hash, dg.bytes, feature, dg.domain);
    }
  }

  // Layer 5: repository guidance (empty for attention)
  if (input.role === 'primaryReview' && input.repositoryGuidance) {
    add(5, 'repository_guidance', 'repository-guidance.md', input.repositoryGuidance.hash, input.repositoryGuidance.bytes, feature, null);
  }

  // Layer 6: engineer feature guidance
  if (input.engineerFeaturePrompt) {
    add(6, 'engineer_feature_guidance', `profile/harnesses/${feature}/prompt.md`, input.engineerFeaturePrompt.hash, input.engineerFeaturePrompt.bytes, feature, null);
  }
  if (input.engineerFeatureSkill) {
    add(6, 'engineer_feature_guidance', `profile/harnesses/${feature}/skills/skill/SKILL.md`, input.engineerFeatureSkill.hash, input.engineerFeatureSkill.bytes, feature, null);
  }

  // Layer 7: engineer domain guidance (empty for attention)
  if (input.role === 'primaryReview') {
    for (const dg of input.engineerDomainGuidance) {
      add(7, 'engineer_domain_guidance', `profile/harnesses/pr-review/domains/${dg.domain}.md`, dg.hash, dg.bytes, feature, dg.domain);
    }
  }

  // Layer 8: persona
  if (input.persona) {
    add(8, 'persona', 'persona.md', input.persona.hash, input.persona.bytes, feature, null);
  }

  // Layer 9: PR inputs + provenance catalog (review only)
  for (const prInput of input.prInputs) {
    add(9, 'pr_inputs', prInput.logicalPath, prInput.hash, prInput.bytes, feature, null);
  }
  if (input.role === 'primaryReview' && input.provenanceCatalog) {
    add(9, 'pr_inputs', input.provenanceCatalog.logicalPath, input.provenanceCatalog.hash, input.provenanceCatalog.bytes, feature, null);
  }

  const manifestHash = computeManifestHash(entries);
  return { entries, manifestHash };
}

function computeManifestHash(entries: ManifestEntry[]): string {
  const canonical = JSON.stringify(
    entries.map(e => ({
      byteLength: e.byteLength,
      contentHash: e.contentHash,
      domain: e.domain,
      entryOrdinal: e.entryOrdinal,
      feature: e.feature,
      layerName: e.layerName,
      layerOrdinal: e.layerOrdinal,
      logicalPath: e.logicalPath,
    })),
  );
  return createHash('sha256').update(canonical).digest('hex');
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/context/harness-manifest.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/context/harness-manifest.ts tests/context/harness-manifest.test.ts
git commit -m "feat(context): nine-layer harness manifest with deterministic ordinals and empty attention layers"
```

---

## Task 15: Provenance Catalog

**Files:**
- Create: `src/context/provenance.ts`
- Test: `tests/context/provenance.test.ts`

- [x] **Step 1: Write failing tests for provenance catalog**

```typescript
// tests/context/provenance.test.ts
import { describe, it, expect } from 'vitest';
import {
  createDiffHunkRecord,
  createCheckRecord,
  createCommentRecord,
  createCommitRecord,
  validateProvenanceRef,
  type ProvenanceRecord,
} from '../../src/context/provenance.js';

describe('provenance ID format', () => {
  it('generates pv_ prefixed IDs', () => {
    const record = createDiffHunkRecord({
      repositoryId: 'pba-webapp',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      canonicalPath: 'src/index.ts',
      hunkHash: 'hunk-hash-1',
      leftRange: { start: 1, end: 5 },
      rightRange: { start: 1, end: 7 },
    });
    expect(record.id).toMatch(/^pv_[a-z2-7]+$/);
  });

  it('is deterministic for same input', () => {
    const input = {
      repositoryId: 'pba-webapp',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      canonicalPath: 'src/index.ts',
      hunkHash: 'hunk-hash-1',
      leftRange: { start: 1, end: 5 },
      rightRange: { start: 1, end: 7 },
    };
    const r1 = createDiffHunkRecord(input);
    const r2 = createDiffHunkRecord(input);
    expect(r1.id).toBe(r2.id);
  });
});

describe('createCheckRecord', () => {
  it('binds check-run ID, name, status, conclusion', () => {
    const record = createCheckRecord({
      checkRunId: 12345,
      attempt: 1,
      name: 'CI / build',
      status: 'completed',
      conclusion: 'success',
      url: 'https://github.com/org/repo/actions/runs/1',
      observedAt: '2026-07-10T00:00:00Z',
    });
    expect(record.type).toBe('check');
    expect(record.id).toMatch(/^pv_/);
    expect(record.data.name).toBe('CI / build');
  });
});

describe('createCommentRecord', () => {
  it('binds GitHub node ID, author, body hash', () => {
    const record = createCommentRecord({
      nodeId: 'IC_kwDOA',
      databaseId: 1234,
      authorLogin: 'reviewer-1',
      bodyHash: 'body-hash-abc',
      commitAssociation: 'a'.repeat(40),
      createdAt: '2026-07-10T00:00:00Z',
      updatedAt: '2026-07-10T00:00:00Z',
    });
    expect(record.type).toBe('comment');
    expect(record.id).toMatch(/^pv_/);
  });
});

describe('createCommitRecord', () => {
  it('binds repository and commit SHA', () => {
    const record = createCommitRecord({
      repositoryId: 'pba-webapp',
      commitSha: 'c'.repeat(40),
    });
    expect(record.type).toBe('commit');
    expect(record.id).toMatch(/^pv_/);
  });
});

describe('validateProvenanceRef', () => {
  it('accepts a known catalog ID', () => {
    const catalog = new Map<string, ProvenanceRecord>();
    const record = createDiffHunkRecord({
      repositoryId: 'pba-webapp',
      baseSha: 'b',
      headSha: 'h',
      canonicalPath: 'f.ts',
      hunkHash: 'hh',
      leftRange: { start: 1, end: 1 },
      rightRange: { start: 1, end: 1 },
    });
    catalog.set(record.id, record);
    expect(validateProvenanceRef(record.id, catalog)).toBe(true);
  });

  it('rejects an unknown ID', () => {
    expect(validateProvenanceRef('pv_unknown', new Map())).toBe(false);
  });

  it('rejects an invented non-pv_ ID', () => {
    expect(validateProvenanceRef('invented-id', new Map())).toBe(false);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/context/provenance.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement provenance catalog**

```typescript
// src/context/provenance.ts
import { createHash } from 'node:crypto';

function base32Encode(buffer: Buffer): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

function makeProvenanceId(canonicalInput: string): string {
  const hash = createHash('sha256').update(canonicalInput).digest();
  return `pv_${base32Encode(hash)}`;
}

export interface ProvenanceRecord {
  id: string;
  type: 'diff_hunk' | 'check' | 'comment' | 'commit';
  data: Record<string, unknown>;
}

export interface DiffHunkInput {
  repositoryId: string;
  baseSha: string;
  headSha: string;
  canonicalPath: string;
  hunkHash: string;
  leftRange: { start: number; end: number };
  rightRange: { start: number; end: number };
}

export function createDiffHunkRecord(input: DiffHunkInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    baseSha: input.baseSha,
    canonicalPath: input.canonicalPath,
    headSha: input.headSha,
    hunkHash: input.hunkHash,
    leftRange: input.leftRange,
    repositoryId: input.repositoryId,
    rightRange: input.rightRange,
    type: 'diff_hunk',
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'diff_hunk',
    data: { ...input },
  };
}

export interface CheckInput {
  checkRunId: number;
  attempt: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  observedAt: string;
}

export function createCheckRecord(input: CheckInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    attempt: input.attempt,
    checkRunId: input.checkRunId,
    conclusion: input.conclusion,
    name: input.name,
    observedAt: input.observedAt,
    status: input.status,
    type: 'check',
    url: input.url,
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'check',
    data: { ...input },
  };
}

export interface CommentInput {
  nodeId: string;
  databaseId: number;
  authorLogin: string;
  bodyHash: string;
  commitAssociation: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createCommentRecord(input: CommentInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    authorLogin: input.authorLogin,
    bodyHash: input.bodyHash,
    commitAssociation: input.commitAssociation,
    createdAt: input.createdAt,
    databaseId: input.databaseId,
    nodeId: input.nodeId,
    type: 'comment',
    updatedAt: input.updatedAt,
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'comment',
    data: { ...input },
  };
}

export interface CommitInput {
  repositoryId: string;
  commitSha: string;
}

export function createCommitRecord(input: CommitInput): ProvenanceRecord {
  const canonical = JSON.stringify({
    commitSha: input.commitSha,
    repositoryId: input.repositoryId,
    type: 'commit',
  });
  return {
    id: makeProvenanceId(canonical),
    type: 'commit',
    data: { ...input },
  };
}

export function validateProvenanceRef(ref: string, catalog: Map<string, ProvenanceRecord>): boolean {
  if (!ref.startsWith('pv_')) return false;
  return catalog.has(ref);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/context/provenance.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/context/provenance.ts tests/context/provenance.test.ts
git commit -m "feat(context): application-created provenance catalog with pv_ IDs for diff/check/comment/commit"
```

---

## Task 16: Coverage and Context Preparation

**Files:**
- Create: `src/context/coverage.ts`
- Create: `src/context/prepare.ts`

- [x] **Step 1: Implement coverage object**

```typescript
// src/context/coverage.ts
import { createHash } from 'node:crypto';

export interface CoverageObject {
  mode: 'registered-source' | 'remote-evidence-only';
  sourceTreeInspected: boolean;
  diffFiltered: boolean;
  omittedProtectedPaths: Array<{ path: string; reason: string }>;
  omittedSourceEntries: Array<{ path: string; reason: string }>;
  missingCoverage: string[];
}

export function buildRegisteredSourceCoverage(
  omittedProtectedPaths: Array<{ path: string; reason: string }>,
  omittedSourceEntries: Array<{ path: string; reason: string }>,
  diffFilterFailed: boolean,
): CoverageObject {
  const missingCoverage: string[] = [];
  if (diffFilterFailed) missingCoverage.push('diff_filter_failed');
  if (omittedProtectedPaths.length > 0) missingCoverage.push('protected_path_content');

  return {
    mode: 'registered-source',
    sourceTreeInspected: true,
    diffFiltered: !diffFilterFailed,
    omittedProtectedPaths,
    omittedSourceEntries,
    missingCoverage,
  };
}

export function buildRemoteOnlyCoverage(
  omittedProtectedPaths: Array<{ path: string; reason: string }>,
  diffFilterFailed: boolean,
): CoverageObject {
  const missingCoverage: string[] = ['source_tree'];
  if (diffFilterFailed) missingCoverage.push('diff_filter_failed');
  if (omittedProtectedPaths.length > 0) missingCoverage.push('protected_path_content');

  return {
    mode: 'remote-evidence-only',
    sourceTreeInspected: false,
    diffFiltered: !diffFilterFailed,
    omittedProtectedPaths,
    omittedSourceEntries: [],
    missingCoverage,
  };
}

export function hashCoverage(coverage: CoverageObject): string {
  const canonical = JSON.stringify({
    diffFiltered: coverage.diffFiltered,
    missingCoverage: [...coverage.missingCoverage].sort(),
    mode: coverage.mode,
    omittedProtectedPaths: coverage.omittedProtectedPaths.map(p => `${p.path}:${p.reason}`).sort(),
    omittedSourceEntries: coverage.omittedSourceEntries.map(p => `${p.path}:${p.reason}`).sort(),
    sourceTreeInspected: coverage.sourceTreeInspected,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
```

- [x] **Step 2: Implement context preparation**

```typescript
// src/context/prepare.ts
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { HarnessManifest } from './harness-manifest.js';
import type { CoverageObject } from './coverage.js';
import type { ProvenanceRecord } from './provenance.js';

export interface RunDirectoryLayout {
  runDir: string;
  jobJsonPath: string;
  runJsonPath: string;
  contextRefsPath: string;
  harnessManifestPath: string;
  harnessDir: string;
  githubDir: string;
  sourceDir: string;
  cursorDir: string;
  transcriptPath: string;
  stderrPath: string;
  outputPath: string;
  validationPath: string;
  validatedProvenancePath: string;
  terminalPath: string;
}

export function computeRunDirectoryLayout(dataDir: string, jobId: string, runId: string): RunDirectoryLayout {
  const jobDir = join(dataDir, 'jobs', jobId);
  const runDir = join(jobDir, 'runs', runId);

  return {
    runDir,
    jobJsonPath: join(jobDir, 'job.json'),
    runJsonPath: join(runDir, 'run.json'),
    contextRefsPath: join(runDir, 'context-refs.json'),
    harnessManifestPath: join(runDir, 'harness-manifest.json'),
    harnessDir: join(runDir, 'harness'),
    githubDir: join(runDir, 'github'),
    sourceDir: join(runDir, 'source'),
    cursorDir: join(runDir, '.cursor'),
    transcriptPath: join(runDir, 'transcript.ndjson'),
    stderrPath: join(runDir, 'stderr.log'),
    outputPath: join(runDir, 'output.json'),
    validationPath: join(runDir, 'validation.json'),
    validatedProvenancePath: join(runDir, 'validated-provenance.json'),
    terminalPath: join(runDir, 'terminal.json'),
  };
}

export interface ContextRef {
  logicalPath: string;
  contentHash: string;
  identityDescription: string;
}

export async function writeCreateOnce(filePath: string, content: string): Promise<void> {
  await fs.mkdir(join(filePath, '..'), { recursive: true });
  const fd = await fs.open(filePath, 'wx');
  try {
    await fd.writeFile(content);
    await fd.datasync();
  } finally {
    await fd.close();
  }
}

export function buildContextRefs(
  manifest: HarnessManifest,
  coverage: CoverageObject,
  provenanceCatalog: ProvenanceRecord[],
  additionalRefs: ContextRef[],
): ContextRef[] {
  const refs: ContextRef[] = [];

  refs.push({
    logicalPath: 'harness-manifest.json',
    contentHash: manifest.manifestHash,
    identityDescription: 'complete ordered harness manifest',
  });

  for (const entry of manifest.entries) {
    refs.push({
      logicalPath: entry.logicalPath,
      contentHash: entry.contentHash,
      identityDescription: `${entry.layerName} layer ${entry.layerOrdinal}`,
    });
  }

  const coverageHash = createHash('sha256')
    .update(JSON.stringify(coverage))
    .digest('hex');
  refs.push({
    logicalPath: 'source/coverage.json',
    contentHash: coverageHash,
    identityDescription: `coverage ${coverage.mode}`,
  });

  if (provenanceCatalog.length > 0) {
    const provHash = createHash('sha256')
      .update(JSON.stringify(provenanceCatalog.map(r => r.id).sort()))
      .digest('hex');
    refs.push({
      logicalPath: 'github/provenance-catalog.json',
      contentHash: provHash,
      identityDescription: 'application-created provenance catalog',
    });
  }

  refs.push(...additionalRefs);

  return refs;
}
```

- [x] **Step 3: Commit**

```bash
git add src/context/coverage.ts src/context/prepare.ts
git commit -m "feat(context): coverage builder and create-once context preparation with directory layout"
```

---

## Task 17: Context Seal

**Files:**
- Create: `src/context/seal.ts`

- [x] **Step 1: Implement run sealing**

```typescript
// src/context/seal.ts
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface TerminalRecord {
  runId: string;
  jobId: string;
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'superseded';
  sealedAt: string;
  failureReason?: string;
  durationMs?: number;
}

export async function sealRun(
  runDir: string,
  record: TerminalRecord,
): Promise<void> {
  const terminalPath = join(runDir, 'terminal.json');
  const content = JSON.stringify(record, null, 2);

  const fd = await fs.open(terminalPath, 'wx');
  try {
    await fd.writeFile(content);
    await fd.datasync();
  } finally {
    await fd.close();
  }

  await makeReadOnly(runDir);
}

async function makeReadOnly(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await makeReadOnly(fullPath);
      await fs.chmod(fullPath, 0o555);
    } else {
      await fs.chmod(fullPath, 0o444);
    }
  }
}

export async function isSealed(runDir: string): Promise<boolean> {
  try {
    await fs.access(join(runDir, 'terminal.json'));
    return true;
  } catch {
    return false;
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/context/seal.ts
git commit -m "feat(context): terminal.json seal with create-once write and recursive read-only"
```

---

## Task 18: Cursor CLI Argv and NDJSON Parser

**Files:**
- Create: `src/cursor/argv.ts`
- Create: `src/cursor/ndjson.ts`
- Test: `tests/cursor/ndjson.test.ts`

- [x] **Step 1: Write failing tests for NDJSON parser**

Critical invariant: **model mismatch between init event and configured role fails the run**.

```typescript
// tests/cursor/ndjson.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseNdjsonLine,
  validateInitEvent,
  extractResultFromTerminal,
  type NdjsonEvent,
  type InitEvent,
  type TerminalEvent,
} from '../../src/cursor/ndjson.js';

describe('parseNdjsonLine', () => {
  it('parses valid JSON lines', () => {
    const event = parseNdjsonLine('{"type":"init","sessionId":"s1","model":"composer-2.5-fast"}');
    expect(event).not.toBeNull();
    expect(event!.type).toBe('init');
  });

  it('returns null for empty lines', () => {
    expect(parseNdjsonLine('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseNdjsonLine('{broken')).toBeNull();
  });

  it('ignores unknown event types gracefully', () => {
    const event = parseNdjsonLine('{"type":"future_unknown","data":"hello"}');
    expect(event).not.toBeNull();
    expect(event!.type).toBe('future_unknown');
  });
});

describe('validateInitEvent', () => {
  it('accepts matching model', () => {
    const init: InitEvent = { type: 'init', sessionId: 'sess-1', model: 'composer-2.5-fast' };
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(true);
  });

  it('CRITICAL: rejects model mismatch', () => {
    const init: InitEvent = { type: 'init', sessionId: 'sess-1', model: 'composer-2.5' };
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('model mismatch');
  });

  it('rejects missing session ID', () => {
    const init = { type: 'init', model: 'composer-2.5-fast' } as InitEvent;
    const result = validateInitEvent(init, 'composer-2.5-fast');
    expect(result.valid).toBe(false);
  });
});

describe('extractResultFromTerminal', () => {
  it('extracts result text from terminal event', () => {
    const terminal: TerminalEvent = {
      type: 'result',
      status: 'completed',
      result: '{"schemaVersion":1}',
      timing: { durationMs: 5000 },
      requestId: 'req-1',
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const result = extractResultFromTerminal(terminal);
    expect(result.text).toBe('{"schemaVersion":1}');
    expect(result.success).toBe(true);
  });

  it('detects is_error flag', () => {
    const terminal: TerminalEvent = {
      type: 'result',
      status: 'error',
      result: '',
      is_error: true,
      timing: { durationMs: 1000 },
      requestId: 'req-1',
      usage: { inputTokens: 10, outputTokens: 0 },
    };
    const result = extractResultFromTerminal(terminal);
    expect(result.success).toBe(false);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cursor/ndjson.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement Cursor CLI argv builder**

```typescript
// src/cursor/argv.ts

export interface CursorArgvInput {
  binary: string;
  runDirectory: string;
  modelId: string;
  prompt: string;
  sourceViewPath?: string; // only for registered-source primaryReview
}

export function buildCursorArgv(input: CursorArgvInput): string[] {
  const args: string[] = [
    input.binary,
    'agent',
    '--print',
    '--mode=ask',
    '--sandbox', 'enabled',
    '--trust',
    '--workspace', input.runDirectory,
    '--model', input.modelId,
    '--output-format', 'stream-json',
  ];

  if (input.sourceViewPath) {
    args.push('--add-dir', input.sourceViewPath);
  }

  args.push(input.prompt);

  return args;
}

export function buildCursorEnvironment(homePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  env.HOME = homePath;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.USER) env.USER = process.env.USER;
  return env;
}
```

- [x] **Step 4: Implement NDJSON parser**

```typescript
// src/cursor/ndjson.ts

export interface NdjsonEvent {
  type: string;
  [key: string]: unknown;
}

export interface InitEvent {
  type: 'init';
  sessionId: string;
  model: string;
}

export interface AssistantEvent {
  type: 'assistant';
  content?: string;
  [key: string]: unknown;
}

export interface TerminalEvent {
  type: 'result';
  status: string;
  result: string;
  is_error?: boolean;
  timing: { durationMs: number };
  requestId: string;
  usage: { inputTokens: number; outputTokens: number };
}

export function parseNdjsonLine(line: string): NdjsonEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as NdjsonEvent;
  } catch {
    return null;
  }
}

export interface InitValidationResult {
  valid: boolean;
  error?: string;
  sessionId?: string;
  actualModel?: string;
}

export function validateInitEvent(
  init: InitEvent,
  expectedModel: string,
): InitValidationResult {
  if (!init.sessionId) {
    return { valid: false, error: 'missing sessionId in init event' };
  }

  if (init.model !== expectedModel) {
    return {
      valid: false,
      error: `model mismatch: expected '${expectedModel}', got '${init.model}'`,
      sessionId: init.sessionId,
      actualModel: init.model,
    };
  }

  return { valid: true, sessionId: init.sessionId, actualModel: init.model };
}

export interface ExtractedResult {
  success: boolean;
  text: string;
  timing?: { durationMs: number };
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export function extractResultFromTerminal(terminal: TerminalEvent): ExtractedResult {
  if (terminal.is_error || terminal.status === 'error') {
    return {
      success: false,
      text: terminal.result ?? '',
      timing: terminal.timing,
      usage: terminal.usage,
      error: `terminal status: ${terminal.status}`,
    };
  }

  return {
    success: true,
    text: terminal.result,
    timing: terminal.timing,
    usage: terminal.usage,
  };
}

export function parseNdjsonStream(raw: string): NdjsonEvent[] {
  return raw.split('\n')
    .map(parseNdjsonLine)
    .filter((e): e is NdjsonEvent => e !== null);
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/cursor/ndjson.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/cursor/argv.ts src/cursor/ndjson.ts tests/cursor/ndjson.test.ts
git commit -m "feat(cursor): CLI argv builder and NDJSON stream parser with model validation"
```

---

## Task 19: Cursor CLI Adapter and Worker Pool

**Files:**
- Create: `src/cursor/adapter.ts`
- Create: `src/cursor/pool.ts`
- Test: `tests/cursor/adapter.fixtures.test.ts`

- [x] **Step 1: Write failing fixture tests for the adapter**

```typescript
// tests/cursor/adapter.fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { buildCursorArgv, type CursorArgvInput } from '../../src/cursor/argv.js';
import {
  getTimeoutForRole,
  STREAM_TRUNCATE_BYTES,
} from '../../src/cursor/adapter.js';

describe('adapter argv fixtures', () => {
  const baseInput: CursorArgvInput = {
    binary: 'agent',
    runDirectory: '/data/jobs/j1/runs/r1',
    modelId: 'composer-2.5-fast',
    prompt: 'Review this PR',
  };

  it('produces correct base argv for primaryReview', () => {
    const argv = buildCursorArgv(baseInput);
    expect(argv).toContain('--mode=ask');
    expect(argv).toContain('--sandbox');
    expect(argv).toContain('enabled');
    expect(argv).toContain('--trust');
    expect(argv).toContain('--output-format');
    expect(argv).toContain('stream-json');
    expect(argv).toContain('--print');
    expect(argv[argv.length - 1]).toBe('Review this PR');
  });

  it('adds --add-dir for registered-source primaryReview', () => {
    const argv = buildCursorArgv({
      ...baseInput,
      sourceViewPath: '/data/worktrees/j1/source',
    });
    const addDirIdx = argv.indexOf('--add-dir');
    expect(addDirIdx).toBeGreaterThan(-1);
    expect(argv[addDirIdx + 1]).toBe('/data/worktrees/j1/source');
  });

  it('CRITICAL: omits --add-dir for attention runs', () => {
    const argv = buildCursorArgv(baseInput);
    expect(argv).not.toContain('--add-dir');
  });

  it('CRITICAL: omits --add-dir for remote-evidence-only', () => {
    const argv = buildCursorArgv({
      ...baseInput,
      sourceViewPath: undefined,
    });
    expect(argv).not.toContain('--add-dir');
  });
});

describe('adapter timeout configuration', () => {
  it('returns 90 seconds for attention role', () => {
    expect(getTimeoutForRole('attention')).toBe(90_000);
  });

  it('returns 20 minutes for primaryReview role', () => {
    expect(getTimeoutForRole('primaryReview')).toBe(20 * 60 * 1000);
  });
});

describe('stream truncation', () => {
  it('enforces 10 MB limit', () => {
    expect(STREAM_TRUNCATE_BYTES).toBe(10 * 1024 * 1024);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cursor/adapter.fixtures.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement adapter**

```typescript
// src/cursor/adapter.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { buildCursorArgv, buildCursorEnvironment, type CursorArgvInput } from './argv.js';
import { parseNdjsonLine, validateInitEvent, extractResultFromTerminal, type InitEvent, type TerminalEvent, type NdjsonEvent } from './ndjson.js';

export const STREAM_TRUNCATE_BYTES = 10 * 1024 * 1024; // 10 MB

const ROLE_TIMEOUTS: Record<string, number> = {
  attention: 90_000,
  primaryReview: 20 * 60 * 1000,
};

export function getTimeoutForRole(role: string, overrideMs?: number): number {
  return overrideMs ?? ROLE_TIMEOUTS[role] ?? ROLE_TIMEOUTS.primaryReview;
}

export interface AdapterRunInput {
  role: 'attention' | 'primaryReview';
  binary: string;
  runDirectory: string;
  modelId: string;
  prompt: string;
  sourceViewPath?: string;
  homePath: string;
  timeoutMs?: number;
  transcriptPath: string;
  stderrPath: string;
}

export interface AdapterRunResult {
  success: boolean;
  sessionId?: string;
  actualModel?: string;
  resultText?: string;
  events: NdjsonEvent[];
  timing?: { durationMs: number };
  usage?: { inputTokens: number; outputTokens: number };
  exitCode: number | null;
  failureReason?: string;
}

export async function runCursorAgent(input: AdapterRunInput): Promise<AdapterRunResult> {
  const argv = buildCursorArgv({
    binary: input.binary,
    runDirectory: input.runDirectory,
    modelId: input.modelId,
    prompt: input.prompt,
    sourceViewPath: input.sourceViewPath,
  });

  const env = buildCursorEnvironment(input.homePath);
  const timeoutMs = getTimeoutForRole(input.role, input.timeoutMs);

  const child = spawn(argv[0], argv.slice(1), {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: input.runDirectory,
  });

  return await collectOutput(child, input.modelId, timeoutMs);
}

async function collectOutput(
  child: ChildProcess,
  expectedModel: string,
  timeoutMs: number,
): Promise<AdapterRunResult> {
  const events: NdjsonEvent[] = [];
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let initEvent: InitEvent | null = null;
  let terminalEvent: TerminalEvent | null = null;

  return new Promise<AdapterRunResult>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, timeoutMs);

    child.stdout!.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= STREAM_TRUNCATE_BYTES) return;
      stdoutBytes += chunk.length;
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseNdjsonLine(line);
        if (event) {
          events.push(event);
          if (event.type === 'init') initEvent = event as unknown as InitEvent;
          if (event.type === 'result') terminalEvent = event as unknown as TerminalEvent;
        }
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderrBytes < STREAM_TRUNCATE_BYTES) {
        stderrBytes += chunk.length;
        stderrBuffer += chunk.toString('utf-8');
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);

      if (stdoutBuffer.trim()) {
        const event = parseNdjsonLine(stdoutBuffer);
        if (event) {
          events.push(event);
          if (event.type === 'init') initEvent = event as unknown as InitEvent;
          if (event.type === 'result') terminalEvent = event as unknown as TerminalEvent;
        }
      }

      if (exitCode !== 0) {
        return resolve({
          success: false, events, exitCode,
          failureReason: `non-zero exit code: ${exitCode}`,
        });
      }

      if (!initEvent) {
        return resolve({
          success: false, events, exitCode,
          failureReason: 'no init event received',
        });
      }

      const initResult = validateInitEvent(initEvent, expectedModel);
      if (!initResult.valid) {
        return resolve({
          success: false, events, exitCode,
          sessionId: initResult.sessionId,
          actualModel: initResult.actualModel,
          failureReason: initResult.error,
        });
      }

      if (!terminalEvent) {
        return resolve({
          success: false, events, exitCode,
          sessionId: initResult.sessionId,
          failureReason: 'no terminal result event',
        });
      }

      const extracted = extractResultFromTerminal(terminalEvent);
      resolve({
        success: extracted.success,
        sessionId: initResult.sessionId,
        actualModel: initResult.actualModel,
        resultText: extracted.text,
        events,
        timing: extracted.timing,
        usage: extracted.usage,
        exitCode,
        failureReason: extracted.success ? undefined : extracted.error,
      });
    });
  });
}
```

- [x] **Step 4: Implement worker pool**

```typescript
// src/cursor/pool.ts

export interface PoolConfig {
  maxConcurrent: number; // 1 or 2
}

interface QueuedWork<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class WorkerPool<T> {
  private active = 0;
  private queue: QueuedWork<T>[] = [];

  constructor(private config: PoolConfig) {
    if (config.maxConcurrent < 1 || config.maxConcurrent > 2) {
      throw new Error(`maxConcurrent must be 1 or 2, got ${config.maxConcurrent}`);
    }
  }

  submit(id: string, execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id, execute, resolve, reject });
      this.drain();
    });
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  private drain(): void {
    while (this.active < this.config.maxConcurrent && this.queue.length > 0) {
      const work = this.queue.shift()!;
      this.active++;
      work.execute()
        .then(work.resolve)
        .catch(work.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/cursor/adapter.fixtures.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/cursor/adapter.ts src/cursor/pool.ts tests/cursor/adapter.fixtures.test.ts
git commit -m "feat(cursor): CLI adapter with SIGTERM/SIGKILL timeout and 1-2 worker pool"
```

---

## Task 20: Review Output Validator

**Files:**
- Create: `src/cursor/validate-review.ts`
- Test: `tests/cursor/validate-review.test.ts`

- [x] **Step 1: Write failing tests for review output validation**

```typescript
// tests/cursor/validate-review.test.ts
import { describe, it, expect } from 'vitest';
import {
  validateReviewOutput,
  type ReviewOutput,
  type ReviewValidationInput,
} from '../../src/cursor/validate-review.js';
import { createDiffHunkRecord, type ProvenanceRecord } from '../../src/context/provenance.js';

function makeCatalog(): Map<string, ProvenanceRecord> {
  const rec = createDiffHunkRecord({
    repositoryId: 'pba-webapp',
    baseSha: 'base',
    headSha: 'head',
    canonicalPath: 'src/index.ts',
    hunkHash: 'hh',
    leftRange: { start: 1, end: 5 },
    rightRange: { start: 1, end: 7 },
  });
  return new Map([[rec.id, rec]]);
}

function makeValidOutput(catalog: Map<string, ProvenanceRecord>): ReviewOutput {
  const provId = [...catalog.keys()][0];
  return {
    schemaVersion: 1,
    coverage: {
      mode: 'registered-source',
      sourceTreeInspected: true,
      diffFiltered: true,
      omittedProtectedPaths: [],
      omittedSourceEntries: [],
      missingCoverage: [],
    },
    summary: { intent: 'Add button', implementation: 'Added React component' },
    observations: [{
      type: 'observation',
      statement: 'The button component is created',
      provenanceRefs: [provId],
      fileReferences: [{
        repositoryId: 'pba-webapp',
        blobSha: 'blob-sha-1',
        path: 'src/components/Button.tsx',
        startLine: 1,
        endLine: 10,
      }],
    }],
    checks: [],
    findings: [{
      severity: 'medium',
      confidence: 'high',
      title: 'Missing test',
      rationale: 'No test for Button',
      file: 'src/components/Button.tsx',
      location: { side: 'RIGHT', line: 5, startSide: null, startLine: null },
      observationIndexes: [0],
      draftComment: 'Consider adding tests',
    }],
    unknowns: [],
    recommendedDisposition: 'comment',
    draftSummary: {
      body: 'This PR adds a Button component.',
      observationIndexes: [0],
      provenanceRefs: [provId],
    },
  };
}

const REGISTERED_COVERAGE = {
  mode: 'registered-source' as const,
  sourceTreeInspected: true,
  diffFiltered: true,
  omittedProtectedPaths: [],
  omittedSourceEntries: [],
  missingCoverage: [],
};

describe('validateReviewOutput', () => {
  it('accepts valid output with matching coverage and provenance', () => {
    const catalog = makeCatalog();
    const sourceManifest = new Map([['src/components/Button.tsx', { blobSha: 'blob-sha-1', lineCount: 50 }]]);
    const result = validateReviewOutput(
      makeValidOutput(catalog),
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest, sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects coverage mismatch', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.coverage.sourceTreeInspected = false;
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('coverage'))).toBe(true);
  });

  it('rejects unknown provenance ref', () => {
    const output = makeValidOutput(makeCatalog());
    output.observations[0].provenanceRefs = ['pv_invented'];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog: new Map(), sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('provenance'))).toBe(true);
  });

  it('CRITICAL: rejects file references in remote-evidence-only', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.coverage = {
      mode: 'remote-evidence-only',
      sourceTreeInspected: false,
      diffFiltered: true,
      omittedProtectedPaths: [],
      omittedSourceEntries: [],
      missingCoverage: ['source_tree'],
    };
    const remoteInput: ReviewValidationInput = {
      coverage: output.coverage,
      catalog,
      sourceManifest: new Map(),
      sourceMode: 'remote-evidence-only',
    };
    const result = validateReviewOutput(output, remoteInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('file reference') || e.includes('remote-evidence'))).toBe(true);
  });

  it('rejects observation with no provenance or file reference', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.observations[0].provenanceRefs = [];
    output.observations[0].fileReferences = [];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects finding with no valid observation index', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.findings[0].observationIndexes = [99];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects empty draftSummary body', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.draftSummary.body = '';
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects empty draftSummary provenance', () => {
    const catalog = makeCatalog();
    const output = makeValidOutput(catalog);
    output.draftSummary.provenanceRefs = [];
    output.draftSummary.observationIndexes = [];
    const result = validateReviewOutput(
      output,
      { coverage: REGISTERED_COVERAGE, catalog, sourceManifest: new Map(), sourceMode: 'registered-source' },
    );
    expect(result.valid).toBe(false);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cursor/validate-review.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement review output validator**

```typescript
// src/cursor/validate-review.ts
import type { CoverageObject } from '../context/coverage.js';
import { validateProvenanceRef, type ProvenanceRecord } from '../context/provenance.js';

const VALID_SEVERITY = new Set(['blocking', 'high', 'medium', 'low']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_DISPOSITION = new Set(['approve', 'comment', 'request_changes', 'needs_human']);
const VALID_OBS_TYPE = new Set(['observation', 'inference']);
const VALID_SIDE = new Set(['LEFT', 'RIGHT']);

export interface FileReference {
  repositoryId: string;
  blobSha: string;
  path: string;
  startLine: number;
  endLine: number;
}

export interface Observation {
  type: string;
  statement: string;
  provenanceRefs: string[];
  fileReferences: FileReference[];
}

export interface Finding {
  severity: string;
  confidence: string;
  title: string;
  rationale: string;
  file: string;
  location: { side: string; line: number; startSide: string | null; startLine: number | null } | null;
  observationIndexes: number[];
  draftComment: string;
}

export interface ReviewOutput {
  schemaVersion: number;
  coverage: CoverageObject;
  summary: { intent: string; implementation: string };
  observations: Observation[];
  checks: Array<{ provenanceRef: string; name: string; status: string; source: string }>;
  findings: Finding[];
  unknowns: string[];
  recommendedDisposition: string;
  draftSummary: {
    body: string;
    observationIndexes: number[];
    provenanceRefs: string[];
  };
}

export interface ReviewValidationInput {
  coverage: CoverageObject;
  catalog: Map<string, ProvenanceRecord>;
  sourceManifest: Map<string, { blobSha: string; lineCount: number }>;
  sourceMode: 'registered-source' | 'remote-evidence-only';
}

export interface ReviewValidationResult {
  valid: boolean;
  errors: string[];
  validatedProvenance: ProvenanceRecord[];
}

export function validateReviewOutput(
  output: ReviewOutput,
  input: ReviewValidationInput,
): ReviewValidationResult {
  const errors: string[] = [];
  const citedProvenance = new Set<string>();

  if (output.schemaVersion !== 1) {
    errors.push(`invalid schemaVersion: ${output.schemaVersion}`);
  }

  if (JSON.stringify(output.coverage) !== JSON.stringify(input.coverage)) {
    errors.push('coverage declaration does not match application-provided coverage');
  }

  if (!VALID_DISPOSITION.has(output.recommendedDisposition)) {
    errors.push(`invalid recommendedDisposition: ${output.recommendedDisposition}`);
  }

  for (let i = 0; i < output.observations.length; i++) {
    const obs = output.observations[i];
    if (!VALID_OBS_TYPE.has(obs.type)) {
      errors.push(`observation[${i}]: invalid type '${obs.type}'`);
    }
    if (obs.provenanceRefs.length === 0 && obs.fileReferences.length === 0) {
      errors.push(`observation[${i}]: must have at least one provenance ref or file reference`);
    }
    for (const ref of obs.provenanceRefs) {
      if (!validateProvenanceRef(ref, input.catalog)) {
        errors.push(`observation[${i}]: unknown provenance ref '${ref}'`);
      } else {
        citedProvenance.add(ref);
      }
    }
    for (const fileRef of obs.fileReferences) {
      if (input.sourceMode === 'remote-evidence-only') {
        errors.push(`observation[${i}]: file reference not allowed in remote-evidence-only`);
      } else {
        const entry = input.sourceManifest.get(fileRef.path);
        if (entry && entry.blobSha !== fileRef.blobSha) {
          errors.push(`observation[${i}]: blob SHA mismatch for ${fileRef.path}`);
        }
        if (fileRef.startLine < 1 || fileRef.endLine < fileRef.startLine) {
          errors.push(`observation[${i}]: invalid line range ${fileRef.startLine}-${fileRef.endLine}`);
        }
        if (entry && fileRef.endLine > entry.lineCount) {
          errors.push(`observation[${i}]: line ${fileRef.endLine} exceeds file length ${entry.lineCount} for ${fileRef.path}`);
        }
      }
    }
  }

  for (let i = 0; i < output.findings.length; i++) {
    const finding = output.findings[i];
    if (!VALID_SEVERITY.has(finding.severity)) {
      errors.push(`finding[${i}]: invalid severity '${finding.severity}'`);
    }
    if (!VALID_CONFIDENCE.has(finding.confidence)) {
      errors.push(`finding[${i}]: invalid confidence '${finding.confidence}'`);
    }
    for (const idx of finding.observationIndexes) {
      if (idx < 0 || idx >= output.observations.length) {
        errors.push(`finding[${i}]: observationIndexes[${idx}] out of range`);
      }
    }
    if (finding.observationIndexes.length === 0) {
      errors.push(`finding[${i}]: must reference at least one observation`);
    }
    if (finding.location) {
      if (!VALID_SIDE.has(finding.location.side)) {
        errors.push(`finding[${i}]: invalid location side '${finding.location.side}'`);
      }
    }
  }

  for (const check of output.checks) {
    if (!validateProvenanceRef(check.provenanceRef, input.catalog)) {
      errors.push(`check '${check.name}': unknown provenanceRef '${check.provenanceRef}'`);
    } else {
      citedProvenance.add(check.provenanceRef);
    }
  }

  if (!output.draftSummary.body || output.draftSummary.body.trim().length === 0) {
    errors.push('draftSummary.body must be non-empty');
  }
  if (output.draftSummary.observationIndexes.length === 0 && output.draftSummary.provenanceRefs.length === 0) {
    errors.push('draftSummary must have non-empty observation indexes or provenance refs');
  }
  for (const ref of output.draftSummary.provenanceRefs) {
    if (!validateProvenanceRef(ref, input.catalog)) {
      errors.push(`draftSummary: unknown provenanceRef '${ref}'`);
    } else {
      citedProvenance.add(ref);
    }
  }
  for (const idx of output.draftSummary.observationIndexes) {
    if (idx < 0 || idx >= output.observations.length) {
      errors.push(`draftSummary: observationIndexes[${idx}] out of range`);
    }
  }

  const dups = output.draftSummary.provenanceRefs.filter(
    (v, i, a) => a.indexOf(v) !== i,
  );
  if (dups.length > 0) {
    errors.push(`draftSummary: duplicate provenanceRefs: ${dups.join(', ')}`);
  }

  const validatedProvenance: ProvenanceRecord[] = [];
  for (const id of citedProvenance) {
    const record = input.catalog.get(id);
    if (record) validatedProvenance.push(record);
  }

  return { valid: errors.length === 0, errors, validatedProvenance };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cursor/validate-review.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/cursor/validate-review.ts tests/cursor/validate-review.test.ts
git commit -m "feat(cursor): review output validator with coverage/provenance/file-reference chain validation"
```

---

## Task 21: Protect-Inputs Hook Template

**Files:**
- Create: `src/cursor/hooks/protect-inputs-template.mjs`

- [x] **Step 1: Implement fail-closed beforeReadFile hook**

This ESM hook runs inside the Cursor agent process. It strips the configured source-view root prefix, canonicalizes the remaining path, and checks against the content-hashed protected-path matcher artifact.

```javascript
// src/cursor/hooks/protect-inputs-template.mjs
//
// GENERATED BY CONTROL TOWER — DO NOT EDIT
// This hook is materialized per-run into .cursor/hooks/protect-inputs.mjs
// with SOURCE_VIEW_ROOT and MATCHER_ARTIFACT_PATH injected.
//
// Contract: failClosed = true. Any failure denies the read.

const SOURCE_VIEW_ROOT = '$$SOURCE_VIEW_ROOT$$';
const MATCHER_ARTIFACT_PATH = '$$MATCHER_ARTIFACT_PATH$$';

let matcherCache = null;

function loadMatcher() {
  if (matcherCache) return matcherCache;
  try {
    const fs = await import('node:fs');
    const raw = fs.readFileSync(MATCHER_ARTIFACT_PATH, 'utf-8');
    matcherCache = JSON.parse(raw);
    return matcherCache;
  } catch {
    return null;
  }
}

function canonicalize(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const normalized = rawPath
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '');
  if (
    normalized.includes('\0') ||
    normalized.includes('..') ||
    normalized.startsWith('/')
  ) {
    return null;
  }
  return normalized;
}

function isProtected(canonicalPath, matcher) {
  if (!matcher || !matcher.patterns) return true; // fail closed
  for (const pattern of matcher.patterns) {
    if (matchGlob(canonicalPath, pattern)) return true;
  }
  return false;
}

function matchGlob(path, pattern) {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.+/)?')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${regex}$`).test(path);
}

export default async function beforeReadFile({ filePath }) {
  if (!filePath) return { allow: false, reason: 'no file path provided' };

  if (!filePath.startsWith(SOURCE_VIEW_ROOT)) {
    return { allow: true };
  }

  const relative = filePath.slice(SOURCE_VIEW_ROOT.length).replace(/^\//, '');
  const canonical = canonicalize(relative);

  if (canonical === null) {
    return { allow: false, reason: 'canonicalization failed' };
  }

  const matcher = await loadMatcher();
  if (!matcher) {
    return { allow: false, reason: 'matcher artifact unavailable — fail closed' };
  }

  if (isProtected(canonical, matcher)) {
    return { allow: false, reason: 'protected_path_content' };
  }

  return { allow: true };
}
```

- [x] **Step 2: Commit**

```bash
git add src/cursor/hooks/protect-inputs-template.mjs
git commit -m "feat(cursor): fail-closed beforeReadFile hook template for protected-path enforcement"
```

---

## Task 22: Work Graph

**Files:**
- Create: `src/orchestrator/work-graph.ts`
- Test: `tests/orchestrator/work-graph.test.ts`

- [x] **Step 1: Write failing tests for work graph projection and focus queue**

Critical invariants: `getAllTracked()` includes ineligible items. `getFocusQueue()` excludes any item with `prioritySortOrdinal >= 4` (i.e. `unranked`).

```typescript
// tests/orchestrator/work-graph.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkGraph, type AllTrackedItem } from '../../src/orchestrator/work-graph.js';
import type { Database } from '../../src/store/db.js';
import type { PolicyDecision } from '../../src/policy/evaluate.js';

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: 'p2',
    prioritySortOrdinal: 2,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: 'auto',
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function makePrRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository_key: 'pba-webapp',
    pr_number: 1,
    head_sha: 'a'.repeat(40),
    base_sha: 'b'.repeat(40),
    title: 'Test PR',
    author: 'dev',
    draft: 0,
    labels_json: '[]',
    additions: 10,
    deletions: 5,
    changed_files_json: '["src/index.ts"]',
    review_requested: 1,
    check_summary_json: '[]',
    updated_at: '2026-07-10T00:00:00.000Z',
    explicit_request_timestamp: null,
    body_truncated: '',
    source_mode: 'registered-source',
    ...overrides,
  };
}

function makeAttentionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository_key: 'pba-webapp',
    pr_number: 1,
    policy_hash: 'hash-1',
    policy_json: JSON.stringify(stubPolicy()),
    state: 'monitoring',
    ...overrides,
  };
}

function createMockDb(prRows: Record<string, unknown>[], attentionRows: Record<string, unknown>[]): Database {
  return {
    run() { return { changes: 0, lastInsertRowid: 0 }; },
    get() { return undefined; },
    all<T>(sql: string): T[] {
      if (sql.includes('FROM prs')) return prRows as T[];
      if (sql.includes('FROM attention_items')) return attentionRows as T[];
      return [];
    },
    transaction<T>(fn: () => T): T { return fn(); },
  };
}

describe('WorkGraph', () => {
  describe('getAllTracked', () => {
    it('returns all PRs including ineligible ones', () => {
      const eligible = makePrRow({ pr_number: 1 });
      const ineligible = makePrRow({ pr_number: 2 });
      const attRows = [
        makeAttentionRow({ pr_number: 1, policy_json: JSON.stringify(stubPolicy({ eligible: true })) }),
        makeAttentionRow({ pr_number: 2, policy_json: JSON.stringify(stubPolicy({ eligible: false, prioritySortOrdinal: 4, priorityStatus: 'unranked' })) }),
      ];
      const db = createMockDb([eligible, ineligible], attRows);
      const graph = new WorkGraph(db);
      const tracked = graph.getAllTracked();

      expect(tracked).toHaveLength(2);
      expect(tracked.find(t => t.prNumber === 2)).toBeDefined();
      expect(tracked.find(t => t.prNumber === 2)!.policy.eligible).toBe(false);
    });

    it('maps snake_case SQL columns to camelCase TypeScript fields', () => {
      const row = makePrRow({ head_sha: 'c'.repeat(40), review_requested: 0 });
      const attRow = makeAttentionRow({ policy_json: JSON.stringify(stubPolicy()) });
      const db = createMockDb([row], [attRow]);
      const graph = new WorkGraph(db);
      const [item] = graph.getAllTracked();

      expect(item.headSha).toBe('c'.repeat(40));
      expect(item.reviewRequested).toBe(false);
      expect(item.changedFiles).toEqual(['src/index.ts']);
    });
  });

  describe('getFocusQueue', () => {
    it('excludes unranked items (prioritySortOrdinal >= 4)', () => {
      const p1 = makePrRow({ pr_number: 1 });
      const unranked = makePrRow({ pr_number: 2 });
      const attRows = [
        makeAttentionRow({ pr_number: 1, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 1, priorityStatus: 'p1' })) }),
        makeAttentionRow({ pr_number: 2, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 4, priorityStatus: 'unranked' })) }),
      ];
      const db = createMockDb([p1, unranked], attRows);
      const graph = new WorkGraph(db);
      const queue = graph.getFocusQueue();

      const allFocusItems = [...queue.now, ...queue.next, ...queue.monitor];
      expect(allFocusItems.find(i => i.prNumber === 2)).toBeUndefined();
      expect(allFocusItems.find(i => i.prNumber === 1)).toBeDefined();
    });

    it('places p0/p1 in now, p2 in next, p3 in monitor', () => {
      const rows = [
        makePrRow({ pr_number: 10 }),
        makePrRow({ pr_number: 20 }),
        makePrRow({ pr_number: 30 }),
      ];
      const attRows = [
        makeAttentionRow({ pr_number: 10, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 0, priorityStatus: 'p0' })) }),
        makeAttentionRow({ pr_number: 20, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 2, priorityStatus: 'p2' })) }),
        makeAttentionRow({ pr_number: 30, policy_json: JSON.stringify(stubPolicy({ prioritySortOrdinal: 3, priorityStatus: 'p3' })) }),
      ];
      const db = createMockDb(rows, attRows);
      const graph = new WorkGraph(db);
      const queue = graph.getFocusQueue();

      expect(queue.now.map(i => i.prNumber)).toContain(10);
      expect(queue.next.map(i => i.prNumber)).toContain(20);
      expect(queue.monitor.map(i => i.prNumber)).toContain(30);
    });

    it('returns empty buckets when no eligible items exist', () => {
      const db = createMockDb([], []);
      const graph = new WorkGraph(db);
      const queue = graph.getFocusQueue();

      expect(queue.now).toEqual([]);
      expect(queue.next).toEqual([]);
      expect(queue.monitor).toEqual([]);
    });
  });
});
```

- [x] **Step 2: Run tests — expect FAIL (module not found)**

Run: `npx vitest run tests/orchestrator/work-graph.test.ts`
Expected: FAIL — Cannot find module

- [x] **Step 3: Implement work graph**

```typescript
// src/orchestrator/work-graph.ts
import type { Database } from '../store/db.js';
import type { PolicyDecision } from '../policy/evaluate.js';

export { AllTrackedItem } from '../policy/evaluate.js';
import type { AllTrackedItem } from '../policy/evaluate.js';

export interface FocusQueue {
  now: AllTrackedItem[];
  next: AllTrackedItem[];
  monitor: AllTrackedItem[];
}

interface PrRow {
  repository_key: string;
  pr_number: number;
  head_sha: string;
  base_sha: string;
  title: string;
  author: string;
  draft: number;
  labels_json: string;
  additions: number;
  deletions: number;
  changed_files_json: string;
  review_requested: number;
  check_summary_json: string;
  updated_at: string | null;
  explicit_request_timestamp: string | null;
  body_truncated: string;
  source_mode: 'registered-source' | 'remote-evidence-only';
}

interface AttentionRow {
  repository_key: string;
  pr_number: number;
  policy_hash: string;
  policy_json: string;
  state: string;
}

function projectTrackedItem(pr: PrRow, attention: AttentionRow): AllTrackedItem {
  const policy: PolicyDecision = JSON.parse(attention.policy_json);
  return {
    repositoryKey: pr.repository_key,
    prNumber: pr.pr_number,
    headSha: pr.head_sha,
    baseSha: pr.base_sha,
    title: pr.title,
    author: pr.author,
    draft: pr.draft === 1,
    labels: JSON.parse(pr.labels_json),
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: JSON.parse(pr.changed_files_json),
    reviewRequested: pr.review_requested === 1,
    checkSummary: JSON.parse(pr.check_summary_json),
    updatedAt: pr.updated_at,
    explicitRequestTimestamp: pr.explicit_request_timestamp,
    policy,
    sourceMode: pr.source_mode,
    bodyTruncated: pr.body_truncated,
  };
}

export class WorkGraph {
  constructor(private readonly db: Database) {}

  getAllTracked(): AllTrackedItem[] {
    const prs = this.db.all<PrRow>(
      `SELECT * FROM prs ORDER BY repository_key, pr_number`,
    );
    const attentionRows = this.db.all<AttentionRow>(
      `SELECT * FROM attention_items ORDER BY repository_key, pr_number`,
    );

    const attentionByKey = new Map<string, AttentionRow>();
    for (const row of attentionRows) {
      attentionByKey.set(`${row.repository_key}:${row.pr_number}`, row);
    }

    const items: AllTrackedItem[] = [];
    for (const pr of prs) {
      const attention = attentionByKey.get(`${pr.repository_key}:${pr.pr_number}`);
      if (!attention) continue;
      items.push(projectTrackedItem(pr, attention));
    }

    return items;
  }

  getFocusQueue(): FocusQueue {
    const all = this.getAllTracked();
    const ranked = all.filter(item => item.policy.prioritySortOrdinal < 4);

    const now: AllTrackedItem[] = [];
    const next: AllTrackedItem[] = [];
    const monitor: AllTrackedItem[] = [];

    for (const item of ranked) {
      const ord = item.policy.prioritySortOrdinal;
      if (ord <= 1) {
        now.push(item);
      } else if (ord === 2) {
        next.push(item);
      } else {
        monitor.push(item);
      }
    }

    return { now, next, monitor };
  }
}
```

- [x] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/orchestrator/work-graph.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/orchestrator/work-graph.ts tests/orchestrator/work-graph.test.ts
git commit -m "feat(orchestrator): work graph with getAllTracked and getFocusQueue projection"
```

---

## Task 23: Enqueue

**Files:**
- Create: `src/orchestrator/enqueue.ts`
- Test: `tests/orchestrator/enqueue.test.ts`

- [x] **Step 1: Write failing tests for job enqueue logic**

Critical invariants: auto-enqueues when `analysisMode === 'auto'`; author-only does not enqueue unless `analysisMode` already reflects an independent priority rule; head SHA / policy_hash / sourceMode change supersedes old job.

```typescript
// tests/orchestrator/enqueue.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueFromPolicyDecision,
  type EnqueueDeps,
  type EnqueueInput,
  type EnqueueResult,
} from '../../src/orchestrator/enqueue.js';
import type { PolicyDecision } from '../../src/policy/evaluate.js';

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: 'p1',
    prioritySortOrdinal: 1,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: 'auto',
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function makeDeps(existingJob?: { id: string; headSha: string; policyHash: string; sourceMode: string; state: string }): EnqueueDeps {
  const jobs = new Map<string, Record<string, unknown>>();
  if (existingJob) {
    jobs.set(existingJob.id, {
      id: existingJob.id,
      head_sha: existingJob.headSha,
      policy_hash: existingJob.policyHash,
      source_mode: existingJob.sourceMode,
      state: existingJob.state,
      version: 1,
    });
  }
  let nextId = 100;
  return {
    findActiveJobByIdentity(identityHash: string) {
      for (const [, job] of jobs) {
        if (!['published', 'cancelled', 'superseded', 'failed'].includes(job.state as string)) {
          return job as { id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number };
        }
      }
      return null;
    },
    insertJob(row: Record<string, unknown>) {
      const id = `job-${nextId++}`;
      jobs.set(id, { ...row, id });
      return id;
    },
    supersede(jobId: string, version: number) {
      const j = jobs.get(jobId);
      if (j) j.state = 'superseded';
    },
    computeIdentityHash(input: Record<string, unknown>) {
      return `hash-${input.repositoryKey}-${input.prNumber}-${input.headSha}`;
    },
    computePolicyHash(decision: PolicyDecision) {
      return `policy-${decision.priorityStatus}-${decision.analysisMode}`;
    },
  };
}

function makeInput(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 42,
    headSha: 'a'.repeat(40),
    sourceMode: 'registered-source' as const,
    policy: stubPolicy(),
    normalizedRepositoryIdentity: 'github:github.com/org/pba-webapp',
    explicitRequest: false,
    ...overrides,
  };
}

describe('enqueueFromPolicyDecision', () => {
  it('auto-enqueues when analysisMode is auto', () => {
    const deps = makeDeps();
    const input = makeInput({ policy: stubPolicy({ analysisMode: 'auto' }) });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(result.jobId).toBeDefined();
    expect(result.reason).toBe('auto_enqueue');
  });

  it('does not enqueue when analysisMode is on_demand and no explicit request', () => {
    const deps = makeDeps();
    const input = makeInput({
      policy: stubPolicy({ analysisMode: 'on_demand' }),
      explicitRequest: false,
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('on_demand_no_request');
  });

  it('enqueues on_demand when explicit request is true', () => {
    const deps = makeDeps();
    const input = makeInput({
      policy: stubPolicy({ analysisMode: 'on_demand' }),
      explicitRequest: true,
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe('explicit_request');
  });

  it('does not enqueue ineligible PRs', () => {
    const deps = makeDeps();
    const input = makeInput({ policy: stubPolicy({ eligible: false }) });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('ineligible');
  });

  it('author-only does not enqueue unless analysisMode is auto', () => {
    const deps = makeDeps();
    const input = makeInput({
      policy: stubPolicy({ authorOnly: true, analysisMode: 'on_demand' }),
      explicitRequest: false,
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('on_demand_no_request');
  });

  it('author-only DOES enqueue when analysisMode is auto (independent priority rule)', () => {
    const deps = makeDeps();
    const input = makeInput({
      policy: stubPolicy({ authorOnly: true, analysisMode: 'auto' }),
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe('auto_enqueue');
  });

  it('supersedes existing job when headSha changes', () => {
    const deps = makeDeps({
      id: 'job-old',
      headSha: 'b'.repeat(40),
      policyHash: 'policy-p1-auto',
      sourceMode: 'registered-source',
      state: 'queued',
    });
    const input = makeInput({
      headSha: 'c'.repeat(40),
      policy: stubPolicy({ analysisMode: 'auto' }),
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(result.superseded).toBe('job-old');
    expect(result.reason).toBe('supersede_head_sha');
  });

  it('supersedes existing job when policy_hash changes', () => {
    const deps = makeDeps({
      id: 'job-old',
      headSha: 'a'.repeat(40),
      policyHash: 'policy-p2-on_demand',
      sourceMode: 'registered-source',
      state: 'queued',
    });
    const input = makeInput({
      policy: stubPolicy({ analysisMode: 'auto', priorityStatus: 'p1' }),
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(result.superseded).toBe('job-old');
    expect(result.reason).toBe('supersede_policy_hash');
  });

  it('supersedes existing job when sourceMode changes', () => {
    const deps = makeDeps({
      id: 'job-old',
      headSha: 'a'.repeat(40),
      policyHash: 'policy-p1-auto',
      sourceMode: 'remote-evidence-only',
      state: 'queued',
    });
    const input = makeInput({
      sourceMode: 'registered-source',
      policy: stubPolicy({ analysisMode: 'auto' }),
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(result.superseded).toBe('job-old');
    expect(result.reason).toBe('supersede_source_mode');
  });

  it('reuses existing job when nothing changed', () => {
    const deps = makeDeps({
      id: 'job-old',
      headSha: 'a'.repeat(40),
      policyHash: 'policy-p1-auto',
      sourceMode: 'registered-source',
      state: 'queued',
    });
    const input = makeInput({ policy: stubPolicy({ analysisMode: 'auto' }) });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('existing_job_current');
    expect(result.jobId).toBe('job-old');
  });
});
```

- [x] **Step 2: Run tests — expect FAIL (module not found)**

Run: `npx vitest run tests/orchestrator/enqueue.test.ts`
Expected: FAIL — Cannot find module

- [x] **Step 3: Implement enqueue logic**

```typescript
// src/orchestrator/enqueue.ts
import type { PolicyDecision } from '../policy/evaluate.js';

export interface EnqueueInput {
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  sourceMode: 'registered-source' | 'remote-evidence-only';
  policy: PolicyDecision;
  normalizedRepositoryIdentity: string;
  explicitRequest: boolean;
}

export interface EnqueueResult {
  enqueued: boolean;
  jobId?: string;
  superseded?: string;
  reason: string;
}

export interface EnqueueDeps {
  findActiveJobByIdentity(identityHash: string): {
    id: string;
    head_sha: string;
    policy_hash: string;
    source_mode: string;
    state: string;
    version: number;
  } | null;
  insertJob(row: Record<string, unknown>): string;
  supersede(jobId: string, version: number): void;
  computeIdentityHash(input: Record<string, unknown>): string;
  computePolicyHash(decision: PolicyDecision): string;
}

export function enqueueFromPolicyDecision(
  deps: EnqueueDeps,
  input: EnqueueInput,
): EnqueueResult {
  if (!input.policy.eligible) {
    return { enqueued: false, reason: 'ineligible' };
  }

  const shouldEnqueue =
    input.policy.analysisMode === 'auto' ||
    (input.policy.analysisMode === 'on_demand' && input.explicitRequest);

  if (!shouldEnqueue) {
    return { enqueued: false, reason: 'on_demand_no_request' };
  }

  const identityHash = deps.computeIdentityHash({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    sourceMode: input.sourceMode,
  });

  const policyHash = deps.computePolicyHash(input.policy);

  const existing = deps.findActiveJobByIdentity(identityHash);
  if (existing) {
    let supersedeReason: string | null = null;
    if (existing.head_sha !== input.headSha) {
      supersedeReason = 'supersede_head_sha';
    } else if (existing.policy_hash !== policyHash) {
      supersedeReason = 'supersede_policy_hash';
    } else if (existing.source_mode !== input.sourceMode) {
      supersedeReason = 'supersede_source_mode';
    }

    if (!supersedeReason) {
      return { enqueued: false, jobId: existing.id, reason: 'existing_job_current' };
    }

    deps.supersede(existing.id, existing.version);

    const jobId = deps.insertJob({
      repositoryKey: input.repositoryKey,
      prNumber: input.prNumber,
      headSha: input.headSha,
      sourceMode: input.sourceMode,
      policyHash,
      identityHash,
      normalizedRepositoryIdentity: input.normalizedRepositoryIdentity,
      prioritySortOrdinal: input.policy.prioritySortOrdinal,
      explicitRequestSort: input.explicitRequest ? 0 : 1,
      queuedAt: new Date().toISOString(),
      state: 'queued',
    });

    return { enqueued: true, jobId, superseded: existing.id, reason: supersedeReason };
  }

  const reason = input.explicitRequest ? 'explicit_request' : 'auto_enqueue';
  const jobId = deps.insertJob({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    sourceMode: input.sourceMode,
    policyHash,
    identityHash,
    normalizedRepositoryIdentity: input.normalizedRepositoryIdentity,
    prioritySortOrdinal: input.policy.prioritySortOrdinal,
    explicitRequestSort: input.explicitRequest ? 0 : 1,
    queuedAt: new Date().toISOString(),
    state: 'queued',
  });

  return { enqueued: true, jobId, reason };
}
```

- [x] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/orchestrator/enqueue.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/orchestrator/enqueue.ts tests/orchestrator/enqueue.test.ts
git commit -m "feat(orchestrator): enqueue logic with auto/on_demand modes and job supersession"
```

---

## Task 24: Pipeline

**Files:**
- Create: `src/orchestrator/pipeline.ts`
- Test: `tests/orchestrator/pipeline.test.ts`

- [x] **Step 1: Write failing tests for pipeline execution**

Pipeline executes a single job through: `preparing_context → preparing_source|running_agent → validating → draft_ready`. Uses injected deps (fake Cursor, fake source, fake context).

```typescript
// tests/orchestrator/pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  executePipeline,
  type PipelineDeps,
  type PipelineJob,
  type PipelineResult,
} from '../../src/orchestrator/pipeline.js';

function makeFakeDeps(options: { shouldFail?: string } = {}): PipelineDeps {
  const transitions: Array<{ jobId: string; from: string; to: string }> = [];
  const runTransitions: Array<{ runId: string; from: string; to: string }> = [];
  let currentJobState = 'queued';
  let currentRunState = 'allocated';
  let jobVersion = 1;
  let runVersion = 1;

  return {
    transitions,
    runTransitions,

    transitionJob(jobId: string, from: string, to: string) {
      if (options.shouldFail === to) {
        throw new Error(`simulated failure at ${to}`);
      }
      transitions.push({ jobId, from, to });
      currentJobState = to;
      jobVersion++;
      return { success: true, newVersion: jobVersion };
    },

    transitionRun(runId: string, from: string, to: string) {
      runTransitions.push({ runId, from, to });
      currentRunState = to;
      runVersion++;
      return { success: true, newVersion: runVersion };
    },

    allocateRun(jobId: string) {
      return { runId: `run-${jobId}`, version: 1 };
    },

    prepareContext(jobId: string, runId: string) {
      return {
        runDir: `/tmp/runs/${runId}`,
        manifest: { layers: 9 },
        coverage: { sourceMode: 'registered-source', inspected: true },
      };
    },

    prepareSource(jobId: string, runId: string) {
      return {
        sourceViewRoot: `/tmp/source/${runId}`,
        adminWorktree: `/tmp/admin/${runId}`,
      };
    },

    runAgent(runId: string, runDir: string) {
      return {
        rawOutput: '{"schemaVersion":1}',
        exitCode: 0,
        modelId: 'claude-sonnet-4-20250514',
      };
    },

    validateOutput(rawOutput: string, context: Record<string, unknown>) {
      return { valid: true, errors: [], validatedProvenance: [] };
    },

    sealRun(runId: string, runDir: string) {
      return { sealed: true };
    },

    updatePointers(jobId: string, runId: string) {
      return { latestRunId: runId, acceptedRunId: runId };
    },

    cleanupSource(runId: string) {},

    getJobState(jobId: string) {
      return { state: currentJobState, version: jobVersion };
    },

    getRunState(runId: string) {
      return { state: currentRunState, version: runVersion };
    },
  };
}

function makeJob(): PipelineJob {
  return {
    id: 'job-1',
    repositoryKey: 'pba-webapp',
    prNumber: 42,
    headSha: 'a'.repeat(40),
    sourceMode: 'registered-source' as const,
    policyHash: 'policy-hash-1',
    identityHash: 'identity-hash-1',
    version: 1,
  };
}

describe('executePipeline', () => {
  it('reaches draft_ready with fake deps', async () => {
    const deps = makeFakeDeps();
    const job = makeJob();
    const result = await executePipeline(deps, job);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe('draft_ready');
    expect(result.runId).toBeDefined();

    const jobStates = deps.transitions.map(t => t.to);
    expect(jobStates).toContain('preparing_context');
    expect(jobStates).toContain('draft_ready');
  });

  it('transitions through preparing_source for registered-source', async () => {
    const deps = makeFakeDeps();
    const job = makeJob();
    await executePipeline(deps, job);

    const jobStates = deps.transitions.map(t => t.to);
    expect(jobStates).toContain('preparing_source');
    expect(jobStates).toContain('running_agent');
  });

  it('skips preparing_source for remote-evidence-only', async () => {
    const deps = makeFakeDeps();
    const job = { ...makeJob(), sourceMode: 'remote-evidence-only' as const };
    await executePipeline(deps, job);

    const jobStates = deps.transitions.map(t => t.to);
    expect(jobStates).not.toContain('preparing_source');
    expect(jobStates).toContain('running_agent');
  });

  it('seals run and updates pointers on success', async () => {
    const deps = makeFakeDeps();
    const job = makeJob();
    const result = await executePipeline(deps, job);

    expect(result.sealed).toBe(true);
    expect(result.latestRunId).toBe(result.runId);
  });

  it('transitions to failed on context preparation error', async () => {
    const deps = makeFakeDeps({ shouldFail: 'preparing_context' });
    const job = makeJob();

    await expect(executePipeline(deps, job)).rejects.toThrow('simulated failure');
  });

  it('cleans up source after run completes', async () => {
    let cleanedUp = false;
    const deps = makeFakeDeps();
    const originalCleanup = deps.cleanupSource;
    deps.cleanupSource = (runId: string) => {
      cleanedUp = true;
      originalCleanup(runId);
    };

    await executePipeline(deps, makeJob());
    expect(cleanedUp).toBe(true);
  });
});
```

- [x] **Step 2: Run tests — expect FAIL (module not found)**

Run: `npx vitest run tests/orchestrator/pipeline.test.ts`
Expected: FAIL — Cannot find module

- [x] **Step 3: Implement pipeline**

```typescript
// src/orchestrator/pipeline.ts

export interface PipelineJob {
  id: string;
  repositoryKey: string;
  prNumber: number;
  headSha: string;
  sourceMode: 'registered-source' | 'remote-evidence-only';
  policyHash: string;
  identityHash: string;
  version: number;
}

export interface PipelineResult {
  success: boolean;
  finalState: string;
  runId: string;
  sealed: boolean;
  latestRunId: string;
  acceptedRunId: string;
}

export interface PipelineDeps {
  transitionJob(jobId: string, from: string, to: string): { success: boolean; newVersion: number };
  transitionRun(runId: string, from: string, to: string): { success: boolean; newVersion: number };
  allocateRun(jobId: string): { runId: string; version: number };
  prepareContext(jobId: string, runId: string): {
    runDir: string;
    manifest: Record<string, unknown>;
    coverage: Record<string, unknown>;
  };
  prepareSource(jobId: string, runId: string): {
    sourceViewRoot: string;
    adminWorktree: string;
  };
  runAgent(runId: string, runDir: string): {
    rawOutput: string;
    exitCode: number;
    modelId: string;
  };
  validateOutput(rawOutput: string, context: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
    validatedProvenance: unknown[];
  };
  sealRun(runId: string, runDir: string): { sealed: boolean };
  updatePointers(jobId: string, runId: string): { latestRunId: string; acceptedRunId: string };
  cleanupSource(runId: string): void;
  getJobState(jobId: string): { state: string; version: number };
  getRunState(runId: string): { state: string; version: number };
  transitions: Array<{ jobId: string; from: string; to: string }>;
  runTransitions: Array<{ runId: string; from: string; to: string }>;
}

export async function executePipeline(
  deps: PipelineDeps,
  job: PipelineJob,
): Promise<PipelineResult> {
  const { runId } = deps.allocateRun(job.id);

  deps.transitionJob(job.id, 'queued', 'preparing_context');
  deps.transitionRun(runId, 'allocated', 'running');

  const context = deps.prepareContext(job.id, runId);

  if (job.sourceMode === 'registered-source') {
    deps.transitionJob(job.id, 'preparing_context', 'preparing_source');
    deps.prepareSource(job.id, runId);
    deps.transitionJob(job.id, 'preparing_source', 'running_agent');
  } else {
    deps.transitionJob(job.id, 'preparing_context', 'running_agent');
  }

  const agentResult = deps.runAgent(runId, context.runDir);

  deps.transitionJob(job.id, 'running_agent', 'validating_output');
  deps.transitionRun(runId, 'running', 'validating');

  const validation = deps.validateOutput(agentResult.rawOutput, context.coverage);

  if (!validation.valid) {
    deps.transitionRun(runId, 'validating', 'failed');
    deps.transitionJob(job.id, 'validating_output', 'failed');
    deps.cleanupSource(runId);
    return {
      success: false,
      finalState: 'failed',
      runId,
      sealed: false,
      latestRunId: runId,
      acceptedRunId: '',
    };
  }

  deps.transitionRun(runId, 'validating', 'succeeded');

  const { sealed } = deps.sealRun(runId, context.runDir);
  const pointers = deps.updatePointers(job.id, runId);

  deps.transitionJob(job.id, 'validating_output', 'draft_ready');

  deps.cleanupSource(runId);

  return {
    success: true,
    finalState: 'draft_ready',
    runId,
    sealed,
    latestRunId: pointers.latestRunId,
    acceptedRunId: pointers.acceptedRunId,
  };
}
```

- [x] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/orchestrator/pipeline.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/orchestrator/pipeline.ts tests/orchestrator/pipeline.test.ts
git commit -m "feat(orchestrator): pipeline executor with injected deps and full state machine flow"
```

---

## Task 25: Facade

**Files:**
- Create: `src/orchestrator/facade.ts`
- Test: `tests/orchestrator/facade.test.ts`

- [x] **Step 1: Write failing tests for OrchestratorFacade**

```typescript
// tests/orchestrator/facade.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOrchestratorFacade,
  type OrchestratorFacade,
  type FacadeDeps,
} from '../../src/orchestrator/facade.js';
import type { AllTrackedItem } from '../../src/policy/evaluate.js';
import type { PolicyDecision } from '../../src/policy/evaluate.js';

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: 'p1',
    prioritySortOrdinal: 1,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: 'auto',
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function makeTrackedItem(overrides: Partial<AllTrackedItem> = {}): AllTrackedItem {
  return {
    repositoryKey: 'pba-webapp',
    prNumber: 1,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    title: 'Test PR',
    author: 'dev',
    draft: false,
    labels: [],
    additions: 10,
    deletions: 5,
    changedFiles: ['src/index.ts'],
    reviewRequested: true,
    checkSummary: [],
    updatedAt: '2026-07-10T00:00:00.000Z',
    explicitRequestTimestamp: null,
    policy: stubPolicy(),
    sourceMode: 'registered-source',
    bodyTruncated: '',
    ...overrides,
  };
}

interface MockJob {
  id: string;
  state: string;
  repositoryKey: string;
  prNumber: number;
}

interface MockDraft {
  jobId: string;
  body: string;
  findings: unknown[];
}

interface MockAuditEvent {
  jobId: string;
  event: string;
  timestamp: string;
}

function makeFacadeDeps(options: {
  tracked?: AllTrackedItem[];
  jobs?: Map<string, MockJob>;
  drafts?: Map<string, MockDraft>;
  auditTrail?: Map<string, MockAuditEvent[]>;
} = {}): FacadeDeps {
  const tracked = options.tracked ?? [makeTrackedItem()];
  const jobs = options.jobs ?? new Map();
  const drafts = options.drafts ?? new Map();
  const auditTrail = options.auditTrail ?? new Map();
  const enqueuedJobs: Array<{ repositoryKey: string; prNumber: number }> = [];

  return {
    getAllTracked: () => tracked,
    getFocusQueue: () => ({
      now: tracked.filter(i => i.policy.prioritySortOrdinal <= 1),
      next: tracked.filter(i => i.policy.prioritySortOrdinal === 2),
      monitor: tracked.filter(i => i.policy.prioritySortOrdinal === 3),
    }),
    getJob: (id: string) => jobs.get(id) ?? null,
    getDraft: (jobId: string) => drafts.get(jobId) ?? null,
    getAuditTrail: (jobId: string) => auditTrail.get(jobId) ?? [],
    enqueueAnalysis: (input: { repositoryKey: string; prNumber: number; sourceMode?: string }) => {
      const id = `job-${enqueuedJobs.length + 1}`;
      enqueuedJobs.push({ repositoryKey: input.repositoryKey, prNumber: input.prNumber });
      return id;
    },
    enqueueRetry: (jobId: string) => {
      return `retry-${jobId}`;
    },
    scheduleAdvice: (repositoryKey: string, prNumber: number) => {},
    getHealthStatus: () => ({
      activeJobs: jobs.size,
      queuedJobs: 0,
      failedJobsLast24h: 0,
      uptime: 3600,
      lastPollTimestamp: '2026-07-10T00:00:00.000Z',
    }),
    enqueuedJobs,
  };
}

describe('OrchestratorFacade', () => {
  describe('getAllTracked', () => {
    it('returns all tracked items from work graph', () => {
      const items = [makeTrackedItem({ prNumber: 1 }), makeTrackedItem({ prNumber: 2 })];
      const deps = makeFacadeDeps({ tracked: items });
      const facade = createOrchestratorFacade(deps);

      expect(facade.getAllTracked()).toHaveLength(2);
    });
  });

  describe('getFocusQueue', () => {
    it('returns bucketed focus queue', () => {
      const items = [
        makeTrackedItem({ prNumber: 1, policy: stubPolicy({ prioritySortOrdinal: 0 }) }),
        makeTrackedItem({ prNumber: 2, policy: stubPolicy({ prioritySortOrdinal: 2 }) }),
      ];
      const deps = makeFacadeDeps({ tracked: items });
      const facade = createOrchestratorFacade(deps);
      const queue = facade.getFocusQueue();

      expect(queue.now).toHaveLength(1);
      expect(queue.next).toHaveLength(1);
    });
  });

  describe('requestAnalyze', () => {
    it('enqueues an analysis job and returns job id', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const jobId = facade.requestAnalyze({
        repositoryKey: 'pba-webapp',
        prNumber: 42,
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(deps.enqueuedJobs).toHaveLength(1);
      expect(deps.enqueuedJobs[0].prNumber).toBe(42);
    });

    it('passes sourceMode to enqueue', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      facade.requestAnalyze({
        repositoryKey: 'pba-webapp',
        prNumber: 42,
        sourceMode: 'remote-evidence-only',
      });

      expect(deps.enqueuedJobs).toHaveLength(1);
    });
  });

  describe('requestRetry', () => {
    it('creates a new run for the given job', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const newRunId = facade.requestRetry('job-1');

      expect(newRunId).toBe('retry-job-1');
    });
  });

  describe('requestAdvice', () => {
    it('schedules advice without throwing', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      expect(() => facade.requestAdvice('pba-webapp', 42)).not.toThrow();
    });
  });

  describe('getHealthStatus', () => {
    it('returns runtime health snapshot', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const health = facade.getHealthStatus();

      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.lastPollTimestamp).toBeDefined();
    });
  });

  describe('getAuditTrail', () => {
    it('returns empty array when no events', () => {
      const deps = makeFacadeDeps();
      const facade = createOrchestratorFacade(deps);
      const trail = facade.getAuditTrail('unknown-job');

      expect(trail).toEqual([]);
    });
  });
});
```

- [x] **Step 2: Run tests — expect FAIL (module not found)**

Run: `npx vitest run tests/orchestrator/facade.test.ts`
Expected: FAIL — Cannot find module

- [x] **Step 3: Implement facade**

```typescript
// src/orchestrator/facade.ts
import type { AllTrackedItem } from '../policy/evaluate.js';

export interface JobDetail {
  id: string;
  state: string;
  repositoryKey: string;
  prNumber: number;
}

export interface DraftDetail {
  jobId: string;
  body: string;
  findings: unknown[];
}

export interface HealthStatus {
  activeJobs: number;
  queuedJobs: number;
  failedJobsLast24h: number;
  uptime: number;
  lastPollTimestamp: string | null;
}

export interface AuditEvent {
  jobId: string;
  event: string;
  timestamp: string;
}

export interface OrchestratorFacade {
  getAllTracked(): AllTrackedItem[];
  getFocusQueue(): { now: AllTrackedItem[]; next: AllTrackedItem[]; monitor: AllTrackedItem[] };
  getJob(id: string): JobDetail | null;
  getDraft(jobId: string): DraftDetail | null;
  getHealthStatus(): HealthStatus;
  getAuditTrail(jobId: string): AuditEvent[];
  requestAnalyze(input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: 'registered-source' | 'remote-evidence-only';
  }): string;
  requestRetry(jobId: string): string;
  requestAdvice(repositoryKey: string, prNumber: number): void;
}

export interface FacadeDeps {
  getAllTracked(): AllTrackedItem[];
  getFocusQueue(): { now: AllTrackedItem[]; next: AllTrackedItem[]; monitor: AllTrackedItem[] };
  getJob(id: string): JobDetail | null;
  getDraft(jobId: string): DraftDetail | null;
  getAuditTrail(jobId: string): AuditEvent[];
  enqueueAnalysis(input: {
    repositoryKey: string;
    prNumber: number;
    sourceMode?: string;
  }): string;
  enqueueRetry(jobId: string): string;
  scheduleAdvice(repositoryKey: string, prNumber: number): void;
  getHealthStatus(): HealthStatus;
  enqueuedJobs: Array<{ repositoryKey: string; prNumber: number }>;
}

export function createOrchestratorFacade(deps: FacadeDeps): OrchestratorFacade {
  return {
    getAllTracked(): AllTrackedItem[] {
      return deps.getAllTracked();
    },

    getFocusQueue() {
      return deps.getFocusQueue();
    },

    getJob(id: string): JobDetail | null {
      return deps.getJob(id);
    },

    getDraft(jobId: string): DraftDetail | null {
      return deps.getDraft(jobId);
    },

    getHealthStatus(): HealthStatus {
      return deps.getHealthStatus();
    },

    getAuditTrail(jobId: string): AuditEvent[] {
      return deps.getAuditTrail(jobId);
    },

    requestAnalyze(input): string {
      return deps.enqueueAnalysis({
        repositoryKey: input.repositoryKey,
        prNumber: input.prNumber,
        sourceMode: input.sourceMode,
      });
    },

    requestRetry(jobId: string): string {
      return deps.enqueueRetry(jobId);
    },

    requestAdvice(repositoryKey: string, prNumber: number): void {
      deps.scheduleAdvice(repositoryKey, prNumber);
    },
  };
}
```

- [x] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/orchestrator/facade.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/orchestrator/facade.ts tests/orchestrator/facade.test.ts
git commit -m "feat(orchestrator): OrchestratorFacade with analyze/retry/advice entry points"
```

---

## Task 26: Daemon Runtime

**Files:**
- Create: `src/daemon/runtime.ts`
- Test: `tests/daemon/runtime.test.ts`

- [x] **Step 1: Write failing tests for daemon runtime**

```typescript
// tests/daemon/runtime.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  startRuntime,
  stopRuntime,
  type RuntimeConfig,
  type RuntimeDeps,
  type RuntimeHandle,
} from '../../src/daemon/runtime.js';

function makeFakeRuntimeDeps(): RuntimeDeps & {
  migrateCalled: boolean;
  recoveryCalled: boolean;
  pollerStarted: boolean;
  schedulerTicks: number;
  attentionBatches: number;
} {
  return {
    migrateCalled: false,
    recoveryCalled: false,
    pollerStarted: false,
    schedulerTicks: 0,
    attentionBatches: 0,

    migrate() {
      this.migrateCalled = true;
    },
    recoverOrphanedStates() {
      this.recoveryCalled = true;
      return { failedJobs: [], failedRuns: [], failedAdvisorRuns: [], autoRetried: [], failureReasons: new Map(), publishingReconciled: [] };
    },
    startDiscoveryPoller() {
      this.pollerStarted = true;
      return { stop: () => { this.pollerStarted = false; } };
    },
    runSchedulerTick() {
      this.schedulerTicks++;
      return { jobsToStart: [], reason: 'no_eligible_candidates' };
    },
    runAttentionBatch() {
      this.attentionBatches++;
    },
    createFacade() {
      return {
        getAllTracked: () => [],
        getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
        getJob: () => null,
        getDraft: () => null,
        getHealthStatus: () => ({
          activeJobs: 0,
          queuedJobs: 0,
          failedJobsLast24h: 0,
          uptime: 0,
          lastPollTimestamp: null,
        }),
        getAuditTrail: () => [],
        requestAnalyze: () => 'job-1',
        requestRetry: () => 'run-1',
        requestAdvice: () => {},
      };
    },
  };
}

const DEFAULT_CONFIG: RuntimeConfig = {
  port: 9120,
  schedulerIntervalMs: 5000,
  attentionIntervalMs: 60000,
  dataDirectory: '/tmp/test-data',
};

describe('startRuntime', () => {
  let handle: RuntimeHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await stopRuntime(handle);
      handle = null;
    }
  });

  it('starts without throwing with fake deps', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(handle).toBeDefined();
    expect(handle.port).toBe(9120);
  });

  it('runs migration on startup', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(deps.migrateCalled).toBe(true);
  });

  it('calls recoverOrphanedStates on startup', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(deps.recoveryCalled).toBe(true);
  });

  it('starts discovery poller', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(deps.pollerStarted).toBe(true);
  });

  it('exposes facade', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    expect(handle.facade).toBeDefined();
    expect(handle.facade.getAllTracked()).toEqual([]);
  });

  it('stopRuntime cleans up poller', async () => {
    const deps = makeFakeRuntimeDeps();
    handle = await startRuntime(DEFAULT_CONFIG, deps);
    await stopRuntime(handle);
    expect(deps.pollerStarted).toBe(false);
    handle = null;
  });
});
```

- [x] **Step 2: Run tests — expect FAIL (module not found)**

Run: `npx vitest run tests/daemon/runtime.test.ts`
Expected: FAIL — Cannot find module

- [x] **Step 3: Implement daemon runtime**

```typescript
// src/daemon/runtime.ts
import type { OrchestratorFacade } from '../orchestrator/facade.js';

export interface RuntimeConfig {
  port: number;
  schedulerIntervalMs: number;
  attentionIntervalMs: number;
  dataDirectory: string;
}

export interface RuntimeHandle {
  port: number;
  facade: OrchestratorFacade;
  stop: () => Promise<void>;
}

export interface RuntimeDeps {
  migrate(): void;
  recoverOrphanedStates(): {
    failedJobs: string[];
    failedRuns: string[];
    failedAdvisorRuns: string[];
    autoRetried: string[];
    failureReasons: Map<string, string>;
    publishingReconciled: string[];
  };
  startDiscoveryPoller(): { stop: () => void };
  runSchedulerTick(): { jobsToStart: string[]; reason: string };
  runAttentionBatch(): void;
  createFacade(): OrchestratorFacade;
}

export async function startRuntime(
  config: RuntimeConfig,
  deps: RuntimeDeps,
): Promise<RuntimeHandle> {
  deps.migrate();
  deps.recoverOrphanedStates();

  const poller = deps.startDiscoveryPoller();

  let schedulerTimer: ReturnType<typeof setInterval> | null = null;
  let attentionTimer: ReturnType<typeof setInterval> | null = null;

  schedulerTimer = setInterval(() => {
    try {
      deps.runSchedulerTick();
    } catch {
      // scheduler tick errors are logged, not fatal
    }
  }, config.schedulerIntervalMs);

  attentionTimer = setInterval(() => {
    try {
      deps.runAttentionBatch();
    } catch {
      // attention batch errors are logged, not fatal
    }
  }, config.attentionIntervalMs);

  const facade = deps.createFacade();

  async function stop(): Promise<void> {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (attentionTimer) {
      clearInterval(attentionTimer);
      attentionTimer = null;
    }
    poller.stop();
  }

  return {
    port: config.port,
    facade,
    stop,
  };
}

export async function stopRuntime(handle: RuntimeHandle): Promise<void> {
  await handle.stop();
}
```

- [x] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/daemon/runtime.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/daemon/runtime.ts tests/daemon/runtime.test.ts
git commit -m "feat(daemon): runtime lifecycle with migrate, recovery, poller, scheduler, and facade exposure"
```

---

## Task 27: Integration Tests

**Files:**
- Create: `tests/integration/analysis-pipeline.test.ts`

- [x] **Step 1: Write integration tests covering poll→policy→enqueue→pipeline→facade flow**

```typescript
// tests/integration/analysis-pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { PolicyDecision } from '../../src/policy/evaluate.js';
import type { AllTrackedItem } from '../../src/policy/evaluate.js';
import { enqueueFromPolicyDecision, type EnqueueDeps, type EnqueueInput } from '../../src/orchestrator/enqueue.js';
import { executePipeline, type PipelineDeps, type PipelineJob } from '../../src/orchestrator/pipeline.js';
import { createOrchestratorFacade, type FacadeDeps } from '../../src/orchestrator/facade.js';
import { startRuntime, stopRuntime, type RuntimeConfig, type RuntimeDeps, type RuntimeHandle } from '../../src/daemon/runtime.js';

function stubPolicy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    eligible: true,
    eligibilityReasons: [],
    exclusionReasons: [],
    authorOnly: false,
    priorityStatus: 'p1',
    prioritySortOrdinal: 1,
    priorityReasons: [],
    allPriorityReasons: [],
    selectedPriorityReason: null,
    analysisMode: 'auto',
    autoAnalyzeReasons: [],
    selectedDomains: [],
    allDomainReasons: [],
    ...overrides,
  };
}

function makeEnqueueDeps(): EnqueueDeps & { jobs: Map<string, Record<string, unknown>> } {
  const jobs = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return {
    jobs,
    findActiveJobByIdentity() { return null; },
    insertJob(row) {
      const id = `job-${nextId++}`;
      jobs.set(id, { ...row, id });
      return id;
    },
    supersede() {},
    computeIdentityHash(input) {
      return `hash-${input.repositoryKey}-${input.prNumber}`;
    },
    computePolicyHash(decision) {
      return `policy-${decision.priorityStatus}`;
    },
  };
}

function makePipelineDeps(): PipelineDeps {
  const transitions: Array<{ jobId: string; from: string; to: string }> = [];
  const runTransitions: Array<{ runId: string; from: string; to: string }> = [];
  let jobVersion = 1;
  let runVersion = 1;

  return {
    transitions,
    runTransitions,
    transitionJob(jobId, from, to) {
      transitions.push({ jobId, from, to });
      jobVersion++;
      return { success: true, newVersion: jobVersion };
    },
    transitionRun(runId, from, to) {
      runTransitions.push({ runId, from, to });
      runVersion++;
      return { success: true, newVersion: runVersion };
    },
    allocateRun(jobId) { return { runId: `run-${jobId}`, version: 1 }; },
    prepareContext(jobId, runId) {
      return { runDir: `/tmp/runs/${runId}`, manifest: { layers: 9 }, coverage: { sourceMode: 'registered-source', inspected: true } };
    },
    prepareSource(jobId, runId) {
      return { sourceViewRoot: `/tmp/source/${runId}`, adminWorktree: `/tmp/admin/${runId}` };
    },
    runAgent(runId, runDir) {
      return { rawOutput: '{"schemaVersion":1,"coverage":{},"summary":{"intent":"test","implementation":"test"},"observations":[],"checks":[],"findings":[],"unknowns":[],"recommendedDisposition":"approve","draftSummary":{"body":"LGTM","observationIndexes":[],"provenanceRefs":[]}}', exitCode: 0, modelId: 'claude-sonnet-4-20250514' };
    },
    validateOutput() { return { valid: true, errors: [], validatedProvenance: [] }; },
    sealRun() { return { sealed: true }; },
    updatePointers(jobId, runId) { return { latestRunId: runId, acceptedRunId: runId }; },
    cleanupSource() {},
    getJobState() { return { state: 'queued', version: jobVersion }; },
    getRunState() { return { state: 'allocated', version: runVersion }; },
  };
}

describe('Integration: poll → policy → auto job queued', () => {
  it('poll fixture produces policy that auto-enqueues a job', () => {
    const deps = makeEnqueueDeps();
    const policy = stubPolicy({ analysisMode: 'auto', priorityStatus: 'p1' });
    const input: EnqueueInput = {
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      sourceMode: 'registered-source',
      policy,
      normalizedRepositoryIdentity: 'github:github.com/org/pba-webapp',
      explicitRequest: false,
    };

    const result = enqueueFromPolicyDecision(deps, input);
    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe('auto_enqueue');
    expect(deps.jobs.size).toBe(1);
  });
});

describe('Integration: pipeline fake → draft_ready → facade.getDraft returns draft', () => {
  it('pipeline reaches draft_ready and facade can retrieve the draft', async () => {
    const pipelineDeps = makePipelineDeps();
    const job: PipelineJob = {
      id: 'job-1',
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      sourceMode: 'registered-source',
      policyHash: 'policy-p1',
      identityHash: 'identity-1',
      version: 1,
    };

    const pipelineResult = await executePipeline(pipelineDeps, job);
    expect(pipelineResult.success).toBe(true);
    expect(pipelineResult.finalState).toBe('draft_ready');

    const drafts = new Map<string, { jobId: string; body: string; findings: unknown[] }>();
    drafts.set('job-1', {
      jobId: 'job-1',
      body: 'LGTM',
      findings: [],
    });

    const facadeDeps: FacadeDeps = {
      getAllTracked: () => [],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: (id) => (id === 'job-1' ? { id: 'job-1', state: 'draft_ready', repositoryKey: 'pba-webapp', prNumber: 42 } : null),
      getDraft: (jobId) => drafts.get(jobId) ?? null,
      getAuditTrail: () => [],
      enqueueAnalysis: () => 'job-new',
      enqueueRetry: () => 'retry-1',
      scheduleAdvice: () => {},
      getHealthStatus: () => ({ activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 0, uptime: 100, lastPollTimestamp: '2026-07-10T00:00:00.000Z' }),
      enqueuedJobs: [],
    };

    const facade = createOrchestratorFacade(facadeDeps);

    const draftResult = facade.getDraft('job-1');
    expect(draftResult).not.toBeNull();
    expect(draftResult!.body).toBe('LGTM');
    expect(draftResult!.jobId).toBe('job-1');
  });
});

describe('Integration: restart recovery then catch-up', () => {
  it('runtime starts, recovers, then catches up via scheduler', async () => {
    let recoveryCalled = false;
    let schedulerTicks = 0;

    const runtimeDeps: RuntimeDeps = {
      migrate() {},
      recoverOrphanedStates() {
        recoveryCalled = true;
        return {
          failedJobs: ['job-orphan-1'],
          failedRuns: ['run-orphan-1'],
          failedAdvisorRuns: [],
          autoRetried: [],
          failureReasons: new Map([['job-orphan-1', 'daemon_restart']]),
          publishingReconciled: [],
        };
      },
      startDiscoveryPoller() {
        return { stop() {} };
      },
      runSchedulerTick() {
        schedulerTicks++;
        return { jobsToStart: [], reason: 'no_eligible_candidates' };
      },
      runAttentionBatch() {},
      createFacade() {
        return {
          getAllTracked: () => [],
          getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
          getJob: () => null,
          getDraft: () => null,
          getHealthStatus: () => ({ activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 0, uptime: 0, lastPollTimestamp: null }),
          getAuditTrail: () => [],
          requestAnalyze: () => 'job-1',
          requestRetry: () => 'run-1',
          requestAdvice: () => {},
        };
      },
    };

    const config: RuntimeConfig = {
      port: 9120,
      schedulerIntervalMs: 100,
      attentionIntervalMs: 100000,
      dataDirectory: '/tmp/test-integration',
    };

    const handle = await startRuntime(config, runtimeDeps);

    expect(recoveryCalled).toBe(true);
    expect(handle.facade).toBeDefined();

    await new Promise(resolve => setTimeout(resolve, 350));
    expect(schedulerTicks).toBeGreaterThanOrEqual(2);

    await stopRuntime(handle);
  });
});
```

- [x] **Step 2: Run tests — expect FAIL (modules not found)**

Run: `npx vitest run tests/integration/analysis-pipeline.test.ts`
Expected: FAIL — Cannot find modules (until Tasks 22–26 are implemented)

- [x] **Step 3: After Tasks 22–26 are implemented, re-run — expect PASS**

Run: `npx vitest run tests/integration/analysis-pipeline.test.ts`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add tests/integration/analysis-pipeline.test.ts
git commit -m "test(integration): end-to-end analysis pipeline: poll→policy→enqueue→pipeline→facade→recovery"
```

---

## Task 28: Source and Agent Failure Recovery

**Files:**
- Create: `src/orchestrator/failure-recovery.ts`
- Create: `tests/orchestrator/failure-recovery.test.ts`

> **§12 invariants:**
> - Authenticated mirror/fetch failure → fail the source-backed job with `fetch_failed`; keep the item visible in All Tracked; do not enter verification/materialization.
> - Credential-free materialization failure → fail with `materialize_failed`; keep the item visible; do not silently downgrade. Recovery path is an explicit human-started `facade.requestAnalyze({ sourceMode: 'remote-evidence-only' })`.
> - Attention advisor failure → set `advisor_status` to `unavailable`; preserve All Tracked and deterministic order; do **not** change `analysis_mode` or cancel auto jobs.
> - Agent timeout/crash/malformed output → seal the immutable run as `failed`, call `cleanupSourcePair`, and create a new attempt only via `requestRetry`.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/orchestrator/failure-recovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  failJobFetch,
  failJobMaterialize,
  markAdvisorUnavailable,
  failAgentRun,
  type FailureRecoveryDeps,
} from '../../src/orchestrator/failure-recovery.js';

interface JobRow {
  id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  repository_key: string;
  pr_number: number;
  analysis_mode?: string;
}

interface RunRow {
  id: string;
  job_id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  attempt_number: number;
  sealed_at: string | null;
}

interface AttentionRow {
  id: string;
  repository_key: string;
  pr_number: number;
  analysis_mode: string;
  advisor_status: string | null;
  auto_analyze: number;
}

function createFakeDb() {
  const jobs = new Map<string, JobRow>();
  const runs = new Map<string, RunRow>();
  const attention = new Map<string, AttentionRow>();

  return {
    jobs,
    runs,
    attention,
    getJob(id: string): JobRow | undefined {
      return jobs.get(id);
    },
    getRun(id: string): RunRow | undefined {
      return runs.get(id);
    },
    getAttention(id: string): AttentionRow | undefined {
      return attention.get(id);
    },
    updateJob(id: string, patch: Partial<JobRow>): void {
      const row = jobs.get(id);
      if (!row) throw new Error(`job not found: ${id}`);
      jobs.set(id, { ...row, ...patch, version: row.version + 1 });
    },
    updateRun(id: string, patch: Partial<RunRow>): void {
      const row = runs.get(id);
      if (!row) throw new Error(`run not found: ${id}`);
      runs.set(id, { ...row, ...patch, version: row.version + 1 });
    },
    updateAttention(id: string, patch: Partial<AttentionRow>): void {
      const row = attention.get(id);
      if (!row) throw new Error(`attention not found: ${id}`);
      attention.set(id, { ...row, ...patch });
    },
    listJobsForTracked(): JobRow[] {
      return [...jobs.values()];
    },
    listAttention(): AttentionRow[] {
      return [...attention.values()];
    },
  };
}

type FakeDb = ReturnType<typeof createFakeDb>;

function makeDeps(db: FakeDb, overrides?: Partial<FailureRecoveryDeps>): FailureRecoveryDeps {
  return {
    getJob: (id) => db.getJob(id) ?? null,
    getRun: (id) => db.getRun(id) ?? null,
    getAttentionByIdentity: (identity) => {
      const row = [...db.attention.values()].find(
        (a) => `${a.repository_key}#${a.pr_number}` === identity,
      );
      return row ?? null;
    },
    transitionJobFailed: (jobId, reason) => {
      db.updateJob(jobId, { state: 'failed', failure_reason: reason });
    },
    transitionRunFailed: (runId, reason, sealedAt) => {
      db.updateRun(runId, {
        state: 'failed',
        failure_reason: reason,
        sealed_at: sealedAt,
      });
    },
    setAdvisorStatus: (attentionId, status) => {
      db.updateAttention(attentionId, { advisor_status: status });
    },
    getAllTracked: () =>
      db.listAttention().map((a) => ({
        repositoryKey: a.repository_key,
        prNumber: a.pr_number,
        analysisMode: a.analysis_mode,
        advisorStatus: a.advisor_status,
      })),
    cleanupSourcePair: vi.fn().mockResolvedValue(undefined),
    sealRun: vi.fn().mockResolvedValue(undefined),
    createRetryAttempt: vi.fn().mockReturnValue('run-retry-1'),
    ...overrides,
  };
}

describe('failJobFetch', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.jobs.set('job-1', {
      id: 'job-1',
      state: 'preparing_source',
      version: 2,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 42,
    });
    db.attention.set('att-1', {
      id: 'att-1',
      repository_key: 'pba-webapp',
      pr_number: 42,
      analysis_mode: 'auto',
      advisor_status: 'fresh',
      auto_analyze: 1,
    });
  });

  it('transitions job to failed with reason fetch_failed', () => {
    const deps = makeDeps(db);
    failJobFetch(deps, 'job-1');

    const job = db.getJob('job-1')!;
    expect(job.state).toBe('failed');
    expect(job.failure_reason).toBe('fetch_failed');
  });

  it('keeps the item visible in getAllTracked', () => {
    const deps = makeDeps(db);
    failJobFetch(deps, 'job-1');

    const tracked = deps.getAllTracked();
    expect(tracked.some((t) => t.repositoryKey === 'pba-webapp' && t.prNumber === 42)).toBe(true);
  });

  it('does not call cleanupSourcePair (fetch never reached materialize)', async () => {
    const deps = makeDeps(db);
    failJobFetch(deps, 'job-1');
    expect(deps.cleanupSourcePair).not.toHaveBeenCalled();
  });
});

describe('failJobMaterialize', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.jobs.set('job-2', {
      id: 'job-2',
      state: 'preparing_source',
      version: 3,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 99,
    });
    db.attention.set('att-2', {
      id: 'att-2',
      repository_key: 'pba-webapp',
      pr_number: 99,
      analysis_mode: 'auto',
      advisor_status: null,
      auto_analyze: 1,
    });
  });

  it('transitions job to failed with reason materialize_failed', () => {
    const deps = makeDeps(db);
    const result = failJobMaterialize(deps, 'job-2');

    const job = db.getJob('job-2')!;
    expect(job.state).toBe('failed');
    expect(job.failure_reason).toBe('materialize_failed');
    // Recovery path: human starts remote-evidence-only via facade — never silent downgrade.
    expect(result.recoveryHint).toEqual({
      action: 'requestAnalyze',
      sourceMode: 'remote-evidence-only',
      repositoryKey: 'pba-webapp',
      prNumber: 99,
    });
  });

  it('keeps the item in getAllTracked after materialize failure', () => {
    const deps = makeDeps(db);
    failJobMaterialize(deps, 'job-2');

    expect(
      deps.getAllTracked().some((t) => t.prNumber === 99),
    ).toBe(true);
  });

  it('documents facade.requestAnalyze({sourceMode:\"remote-evidence-only\"}) as recovery', () => {
    const deps = makeDeps(db);
    const result = failJobMaterialize(deps, 'job-2');
    expect(result.recoveryHint.action).toBe('requestAnalyze');
    expect(result.recoveryHint.sourceMode).toBe('remote-evidence-only');
    // Callers wire: facade.requestAnalyze({ repositoryKey, prNumber, sourceMode: 'remote-evidence-only' })
  });
});

describe('markAdvisorUnavailable', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.attention.set('att-3', {
      id: 'att-3',
      repository_key: 'pba-webapp',
      pr_number: 7,
      analysis_mode: 'auto',
      advisor_status: 'fresh',
      auto_analyze: 1,
    });
    db.jobs.set('job-auto-7', {
      id: 'job-auto-7',
      state: 'queued',
      version: 1,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 7,
    });
  });

  it('sets advisor_status to unavailable', () => {
    const deps = makeDeps(db);
    markAdvisorUnavailable(deps, 'pba-webapp#7');

    expect(db.getAttention('att-3')!.advisor_status).toBe('unavailable');
  });

  it('does not change analysisMode', () => {
    const deps = makeDeps(db);
    markAdvisorUnavailable(deps, 'pba-webapp#7');

    expect(db.getAttention('att-3')!.analysis_mode).toBe('auto');
    const tracked = deps.getAllTracked().find((t) => t.prNumber === 7)!;
    expect(tracked.analysisMode).toBe('auto');
  });

  it('does not cancel auto jobs', () => {
    const deps = makeDeps(db);
    markAdvisorUnavailable(deps, 'pba-webapp#7');

    const job = db.getJob('job-auto-7')!;
    expect(job.state).toBe('queued');
    expect(job.failure_reason).toBeNull();
  });
});

describe('failAgentRun', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
    db.jobs.set('job-3', {
      id: 'job-3',
      state: 'running_agent',
      version: 4,
      failure_reason: null,
      repository_key: 'pba-webapp',
      pr_number: 55,
    });
    db.runs.set('run-1', {
      id: 'run-1',
      job_id: 'job-3',
      state: 'running',
      version: 2,
      failure_reason: null,
      attempt_number: 1,
      sealed_at: null,
    });
    db.attention.set('att-55', {
      id: 'att-55',
      repository_key: 'pba-webapp',
      pr_number: 55,
      analysis_mode: 'on_demand',
      advisor_status: null,
      auto_analyze: 0,
    });
  });

  it('seals the run as failed and records the reason', async () => {
    const deps = makeDeps(db);
    await failAgentRun(deps, 'run-1', 'agent_timeout');

    const run = db.getRun('run-1')!;
    expect(run.state).toBe('failed');
    expect(run.failure_reason).toBe('agent_timeout');
    expect(run.sealed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deps.sealRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ outcome: 'failed', failureReason: 'agent_timeout' }),
    );
  });

  it('calls cleanupSourcePair for the job', async () => {
    const deps = makeDeps(db);
    await failAgentRun(deps, 'run-1', 'agent_crash');

    expect(deps.cleanupSourcePair).toHaveBeenCalledWith('job-3');
  });

  it('fails the parent job and does not create a new attempt automatically', async () => {
    const deps = makeDeps(db);
    await failAgentRun(deps, 'run-1', 'malformed_output');

    expect(db.getJob('job-3')!.state).toBe('failed');
    expect(db.getJob('job-3')!.failure_reason).toBe('malformed_output');
    expect(deps.createRetryAttempt).not.toHaveBeenCalled();
  });

  it('only requestRetry creates a new attempt', async () => {
    const deps = makeDeps(db);
    await failAgentRun(deps, 'run-1', 'agent_timeout');

    expect(deps.createRetryAttempt).not.toHaveBeenCalled();

    // Manual retry path (wired through facade.requestRetry → createRetryAttempt)
    const newRunId = deps.createRetryAttempt('job-3');
    expect(newRunId).toBe('run-retry-1');
    expect(deps.createRetryAttempt).toHaveBeenCalledWith('job-3');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator/failure-recovery.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement failure recovery**

```typescript
// src/orchestrator/failure-recovery.ts

export interface TrackedProjection {
  repositoryKey: string;
  prNumber: number;
  analysisMode: string;
  advisorStatus: string | null;
}

export interface JobSnapshot {
  id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  repository_key: string;
  pr_number: number;
}

export interface RunSnapshot {
  id: string;
  job_id: string;
  state: string;
  version: number;
  failure_reason: string | null;
  attempt_number: number;
  sealed_at: string | null;
}

export interface AttentionSnapshot {
  id: string;
  repository_key: string;
  pr_number: number;
  analysis_mode: string;
  advisor_status: string | null;
  auto_analyze: number;
}

export interface MaterializeRecoveryHint {
  action: 'requestAnalyze';
  sourceMode: 'remote-evidence-only';
  repositoryKey: string;
  prNumber: number;
}

export interface FailureRecoveryDeps {
  getJob: (jobId: string) => JobSnapshot | null;
  getRun: (runId: string) => RunSnapshot | null;
  getAttentionByIdentity: (identity: string) => AttentionSnapshot | null;
  transitionJobFailed: (jobId: string, reason: string) => void;
  transitionRunFailed: (runId: string, reason: string, sealedAt: string) => void;
  setAdvisorStatus: (attentionId: string, status: 'unavailable') => void;
  getAllTracked: () => TrackedProjection[];
  cleanupSourcePair: (jobId: string) => Promise<void>;
  sealRun: (
    runId: string,
    record: { outcome: 'failed'; failureReason: string; sealedAt: string },
  ) => Promise<void>;
  /** Only invoked by facade.requestRetry — never by failAgentRun. */
  createRetryAttempt: (jobId: string) => string;
}

/**
 * Authenticated mirror/fetch failure (§12).
 * Terminates the credential-bearing path; item remains in All Tracked.
 */
export function failJobFetch(deps: FailureRecoveryDeps, jobId: string): void {
  const job = deps.getJob(jobId);
  if (!job) throw new Error(`failJobFetch: job not found: ${jobId}`);
  deps.transitionJobFailed(jobId, 'fetch_failed');
}

/**
 * Credential-free SHA/tree/object/materialization failure (§12).
 * Does not silently downgrade to remote-evidence-only.
 * Recovery: facade.requestAnalyze({ sourceMode: 'remote-evidence-only', ... }).
 */
export function failJobMaterialize(
  deps: FailureRecoveryDeps,
  jobId: string,
): { recoveryHint: MaterializeRecoveryHint } {
  const job = deps.getJob(jobId);
  if (!job) throw new Error(`failJobMaterialize: job not found: ${jobId}`);
  deps.transitionJobFailed(jobId, 'materialize_failed');
  return {
    recoveryHint: {
      action: 'requestAnalyze',
      sourceMode: 'remote-evidence-only',
      repositoryKey: job.repository_key,
      prNumber: job.pr_number,
    },
  };
}

/**
 * Attention advisor failure or staleness (§12).
 * Shows unavailable advice; preserves analysis_mode and does not cancel auto jobs.
 */
export function markAdvisorUnavailable(
  deps: FailureRecoveryDeps,
  identity: string,
): void {
  const item = deps.getAttentionByIdentity(identity);
  if (!item) throw new Error(`markAdvisorUnavailable: identity not found: ${identity}`);
  deps.setAdvisorStatus(item.id, 'unavailable');
}

/**
 * Agent timeout / crash / malformed output (§12).
 * Seals the immutable run as failed, removes admin/source pair,
 * and leaves retry to facade.requestRetry → createRetryAttempt only.
 */
export async function failAgentRun(
  deps: FailureRecoveryDeps,
  runId: string,
  reason: string,
): Promise<void> {
  const run = deps.getRun(runId);
  if (!run) throw new Error(`failAgentRun: run not found: ${runId}`);

  const sealedAt = new Date().toISOString();
  deps.transitionRunFailed(runId, reason, sealedAt);
  await deps.sealRun(runId, {
    outcome: 'failed',
    failureReason: reason,
    sealedAt,
  });
  await deps.cleanupSourcePair(run.job_id);
  deps.transitionJobFailed(run.job_id, reason);
  // Intentionally does NOT call createRetryAttempt — only requestRetry may.
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator/failure-recovery.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/failure-recovery.ts tests/orchestrator/failure-recovery.test.ts
git commit -m "feat(orchestrator): §12 source, advisor, and agent failure recovery"
```

---

## Task 28: Source and Agent Failure Recovery

**Files:**
- Create: `tests/orchestrator/failure-recovery.test.ts`
- Modify: `src/orchestrator/pipeline.ts` (add `failureReason`, `advisorStatus` to `PipelineResult`; add optional `runAdvisor` to `PipelineDeps`; wrap each pipeline stage in try/catch)

- [ ] **Step 1: Write failing tests for each failure path**

```typescript
// tests/orchestrator/failure-recovery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executePipeline, type PipelineDeps, type PipelineJob } from '../../src/orchestrator/pipeline.js';
import { createOrchestratorFacade, type FacadeDeps } from '../../src/orchestrator/facade.js';

function makeJob(overrides: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: 'job-1',
    repositoryKey: 'pba-webapp',
    prNumber: 42,
    headSha: 'a'.repeat(40),
    sourceMode: 'registered-source',
    policyHash: 'policy-p1',
    identityHash: 'identity-1',
    version: 1,
    ...overrides,
  };
}

function makeBaseDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  let jobVersion = 1;
  let runVersion = 1;
  return {
    transitionJob(jobId, from, to) {
      jobVersion++;
      return { success: true, newVersion: jobVersion };
    },
    transitionRun(runId, from, to) {
      runVersion++;
      return { success: true, newVersion: runVersion };
    },
    allocateRun(jobId) { return { runId: `run-${jobId}`, version: 1 }; },
    prepareSource(jobId, runId) {
      return { sourceViewRoot: `/tmp/source/${runId}`, adminWorktree: `/tmp/admin/${runId}` };
    },
    prepareContext(jobId, runId) {
      return { runDir: `/tmp/runs/${runId}`, manifest: { layers: 9 }, coverage: { sourceMode: 'registered-source', inspected: true } };
    },
    runAgent(runId, runDir) {
      return {
        rawOutput: JSON.stringify({
          schemaVersion: 1, coverage: {}, summary: { intent: 'test', implementation: 'test' },
          observations: [], checks: [], findings: [], unknowns: [],
          recommendedDisposition: 'approve',
          draftSummary: { body: 'LGTM', observationIndexes: [], provenanceRefs: [] },
        }),
        exitCode: 0,
        modelId: 'claude-sonnet-4-20250514',
      };
    },
    validateOutput() { return { valid: true, errors: [], validatedProvenance: [] }; },
    sealRun(runId) { return { sealed: true }; },
    updatePointers(jobId, runId) { return { latestRunId: runId, acceptedRunId: runId }; },
    cleanupSource() {},
    getJobState() { return { state: 'queued', version: jobVersion }; },
    getRunState() { return { state: 'allocated', version: runVersion }; },
    ...overrides,
  } as PipelineDeps;
}

// ── Fetch failure ──────────────────────────────────────────────

describe('Fetch failure recovery', () => {
  it('fails job with fetch_failed when prepareSource throws', async () => {
    const transitions: Array<{ jobId: string; to: string }> = [];
    const cleanedUp: string[] = [];
    const deps = makeBaseDeps({
      prepareSource() { throw new Error('git fetch failed: connection refused'); },
      transitionJob(jobId, from, to) {
        transitions.push({ jobId, to });
        return { success: true, newVersion: 2 };
      },
      cleanupSource(runId) { cleanedUp.push(runId); },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('fetch_failed');
    expect(transitions.some(t => t.to === 'failed')).toBe(true);
    expect(cleanedUp.length).toBeGreaterThanOrEqual(1);
  });

  it('item remains visible in All Tracked after fetch_failed', () => {
    const facadeDeps: FacadeDeps = {
      getAllTracked: () => [
        {
          repositoryKey: 'pba-webapp', prNumber: 42, eligible: true,
          priorityStatus: 'p1', latestJobState: 'failed', failureReason: 'fetch_failed',
        },
      ],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: () => null,
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: () => 'job-2',
      enqueueRetry: () => 'retry-1',
      scheduleAdvice: () => {},
      getHealthStatus: () => ({
        activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 1,
        uptime: 100, lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    };
    const facade = createOrchestratorFacade(facadeDeps);
    const tracked = facade.getAllTracked();

    expect(tracked).toHaveLength(1);
    expect(tracked[0].failureReason).toBe('fetch_failed');
  });
});

// ── Materialize failure ────────────────────────────────────────

describe('Materialize failure recovery', () => {
  it('fails job with materialize_failed when prepareContext throws', async () => {
    const transitions: Array<{ jobId: string; to: string }> = [];
    const deps = makeBaseDeps({
      prepareContext() { throw new Error('materialize: checkout conflict'); },
      transitionJob(jobId, from, to) {
        transitions.push({ jobId, to });
        return { success: true, newVersion: 2 };
      },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('materialize_failed');
  });

  it('requestAnalyze with remote-evidence-only available after materialize failure', () => {
    let lastSourceMode: string | undefined;
    const facadeDeps: FacadeDeps = {
      getAllTracked: () => [],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: () => ({
        id: 'job-1', state: 'failed', failureReason: 'materialize_failed',
        repositoryKey: 'pba-webapp', prNumber: 42,
      }),
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: (input) => {
        lastSourceMode = input.sourceMode;
        return 'job-2';
      },
      enqueueRetry: () => 'retry-1',
      scheduleAdvice: () => {},
      getHealthStatus: () => ({
        activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 1,
        uptime: 100, lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    };
    const facade = createOrchestratorFacade(facadeDeps);

    facade.requestAnalyze({
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      sourceMode: 'remote-evidence-only',
    });

    expect(lastSourceMode).toBe('remote-evidence-only');
  });
});

// ── Advisor failure ────────────────────────────────────────────

describe('Advisor failure recovery', () => {
  it('marks advisor_status unavailable without blocking auto-analysis', async () => {
    const deps = makeBaseDeps({
      runAdvisor() { throw new Error('advisor: model timeout'); },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(true);
    expect(result.finalState).toBe('draft_ready');
    expect(result.advisorStatus).toBe('unavailable');
  });

  it('pipeline reaches same draft_ready state regardless of advisor failure', async () => {
    const depsOk = makeBaseDeps({
      runAdvisor() { return { advice: { items: [] } }; },
    });
    const depsFail = makeBaseDeps({
      runAdvisor() { throw new Error('advisor timeout'); },
    });

    const resultOk = await executePipeline(depsOk, makeJob({ id: 'job-a' }));
    const resultFail = await executePipeline(depsFail, makeJob({ id: 'job-b' }));

    expect(resultOk.success).toBe(true);
    expect(resultFail.success).toBe(true);
    expect(resultOk.finalState).toBe('draft_ready');
    expect(resultFail.finalState).toBe('draft_ready');
    expect(resultOk.advisorStatus).toBe('available');
    expect(resultFail.advisorStatus).toBe('unavailable');
  });
});

// ── Agent timeout / malformed output ───────────────────────────

describe('Agent timeout/malformed recovery', () => {
  it('seals failed run on agent timeout', async () => {
    let sealedRunId: string | undefined;
    const deps = makeBaseDeps({
      runAgent() { throw new Error('agent: process timed out after 300s'); },
      sealRun(runId) { sealedRunId = runId; return { sealed: true }; },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('agent_failed');
    expect(sealedRunId).toBeDefined();
  });

  it('seals failed run on malformed agent output', async () => {
    let sealedRunId: string | undefined;
    const deps = makeBaseDeps({
      runAgent() {
        return { rawOutput: 'not json at all', exitCode: 0, modelId: 'test' };
      },
      validateOutput() {
        return { valid: false, errors: ['invalid JSON'], validatedProvenance: [] };
      },
      sealRun(runId) { sealedRunId = runId; return { sealed: true }; },
    });

    const result = await executePipeline(deps, makeJob());

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('agent_failed');
    expect(sealedRunId).toBeDefined();
  });

  it('cleans up admin and source worktrees after agent failure', async () => {
    const cleanedUp: string[] = [];
    const deps = makeBaseDeps({
      runAgent() { throw new Error('timeout'); },
      cleanupSource(runId) { cleanedUp.push(runId); },
    });

    await executePipeline(deps, makeJob());

    expect(cleanedUp.length).toBeGreaterThanOrEqual(1);
  });

  it('only requestRetry creates new attempt after agent failure', () => {
    let retryCreated = false;
    const facadeDeps: FacadeDeps = {
      getAllTracked: () => [],
      getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
      getJob: () => ({
        id: 'job-1', state: 'failed', failureReason: 'agent_failed',
        repositoryKey: 'pba-webapp', prNumber: 42,
      }),
      getDraft: () => null,
      getAuditTrail: () => [],
      enqueueAnalysis: () => 'job-2',
      enqueueRetry: () => { retryCreated = true; return 'run-2'; },
      scheduleAdvice: () => {},
      getHealthStatus: () => ({
        activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 1,
        uptime: 100, lastPollTimestamp: null,
      }),
      enqueuedJobs: [],
    };
    const facade = createOrchestratorFacade(facadeDeps);

    facade.requestRetry('job-1');

    expect(retryCreated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator/failure-recovery.test.ts`
Expected: FAIL — `failureReason` and `advisorStatus` not on `PipelineResult`, `runAdvisor` not on `PipelineDeps`

- [ ] **Step 3: Update `src/orchestrator/pipeline.ts` with failure recovery**

Add to `PipelineResult`:

```typescript
export interface PipelineResult {
  success: boolean;
  finalState: string;
  /** Set on failure: 'fetch_failed' | 'materialize_failed' | 'agent_failed' | 'allocation_failed' */
  failureReason?: string;
  /** Set when runAdvisor dep is present */
  advisorStatus?: 'available' | 'unavailable';
}
```

Add optional advisor to `PipelineDeps`:

```typescript
// Add to PipelineDeps interface
runAdvisor?: (runId: string) => { advice: unknown };
```

Replace `executePipeline` body with staged try/catch:

```typescript
export async function executePipeline(
  deps: PipelineDeps,
  job: PipelineJob,
): Promise<PipelineResult> {
  let runId: string | undefined;
  let advisorStatus: 'available' | 'unavailable' | undefined;

  // Stage 1: allocate run
  try {
    const allocated = deps.allocateRun(job.id);
    runId = allocated.runId;
    deps.transitionRun(runId, 'init', 'allocated');
    deps.transitionJob(job.id, 'queued', 'active');
  } catch {
    deps.transitionJob(job.id, 'queued', 'failed');
    return { success: false, finalState: 'failed', failureReason: 'allocation_failed' };
  }

  // Stage 2: fetch source — §12 fetch failure terminates cred child
  try {
    deps.prepareSource(job.id, runId);
  } catch {
    deps.transitionJob(job.id, 'active', 'failed');
    try { deps.sealRun(runId); } catch { /* best-effort seal */ }
    try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }
    return { success: false, finalState: 'failed', failureReason: 'fetch_failed' };
  }

  // Stage 3: materialize context — §12 materialize failure leaves remote-evidence-only available
  try {
    deps.prepareContext(job.id, runId);
  } catch {
    deps.transitionJob(job.id, 'active', 'failed');
    try { deps.sealRun(runId); } catch { /* best-effort seal */ }
    try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }
    return { success: false, finalState: 'failed', failureReason: 'materialize_failed' };
  }

  // Stage 4: optional advisor — §12 advisor failure marks unavailable, does not block pipeline
  if (deps.runAdvisor) {
    try {
      deps.runAdvisor(runId);
      advisorStatus = 'available';
    } catch {
      advisorStatus = 'unavailable';
    }
  }

  // Stage 5: run agent + validate — §12 timeout/malformed seals failed run, cleanup
  try {
    const agentResult = deps.runAgent(runId, `/tmp/runs/${runId}`);
    const validation = deps.validateOutput(agentResult);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }
  } catch {
    deps.transitionRun(runId, 'running', 'failed');
    deps.transitionJob(job.id, 'active', 'failed');
    try { deps.sealRun(runId); } catch { /* best-effort seal */ }
    try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }
    return { success: false, finalState: 'failed', failureReason: 'agent_failed', advisorStatus };
  }

  // Stage 6: seal + finalize
  deps.sealRun(runId);
  deps.updatePointers(job.id, runId);
  deps.transitionJob(job.id, 'active', 'draft_ready');
  try { deps.cleanupSource(runId); } catch { /* best-effort cleanup */ }

  return { success: true, finalState: 'draft_ready', advisorStatus };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/orchestrator/failure-recovery.test.ts`
Expected: all 9 tests PASS

- [ ] **Step 5: Run existing pipeline tests — expect PASS (no regression)**

Run: `npx vitest run tests/orchestrator/pipeline.test.ts tests/integration/analysis-pipeline.test.ts`
Expected: PASS (new optional fields on `PipelineResult` don't break existing assertions)

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/pipeline.ts tests/orchestrator/failure-recovery.test.ts
git commit -m "feat(orchestrator): §12 source and agent failure recovery with per-stage try/catch"
```

---

## Summary of Critical Invariants Tested

| Invariant | Verified in |
|-----------|-------------|
| Job identity excludes harness/model/context hashes | Task 3: `job-identity.test.ts` — `JobIdentityInput` type has no harness/model/context fields |
| Advice never enqueues analysis | Task 6: `candidates.test.ts` — no `enqueueAnalysis` on selected output; Task 9: `validate-output.test.ts` — forbidden `enqueueAnalysis` field |
| Fetch env has SSH; materialize env does not | Task 11: `fetch-boundary.test.ts` — `SSH_AUTH_SOCK` present; Task 12: `materialize.test.ts` — `SSH_AUTH_SOCK` absent |
| Remote-evidence-only: no `--add-dir`, no file provenance | Task 13: `remote-evidence.test.ts` — `sourceTreeInspected: false`; Task 19: `adapter.fixtures.test.ts` — no `--add-dir`; Task 20: `validate-review.test.ts` — file references rejected |
| Manifest layers 4/5/7 empty for attention | Task 14: `harness-manifest.test.ts` — explicit layer emptiness assertion |
| Model mismatch fails the run | Task 18: `ndjson.test.ts` — `validateInitEvent` rejects mismatch |
| Unranked items excluded from Focus Queue | Task 22: `work-graph.test.ts` — `prioritySortOrdinal >= 4` never in `now`/`next`/`monitor` |
| All Tracked includes ineligible | Task 22: `work-graph.test.ts` — ineligible items appear in `getAllTracked()` |
| Auto-enqueue respects analysisMode | Task 23: `enqueue.test.ts` — `auto` enqueues, `on_demand` without explicit request does not |
| Head SHA / policy_hash / sourceMode change supersedes | Task 23: `enqueue.test.ts` — old job superseded, new job created |
| Pipeline reaches draft_ready with fakes | Task 24: `pipeline.test.ts` — full state machine traversal with injected deps |
| Facade analyze/retry/advice entry points | Task 25: `facade.test.ts` — each method delegates to deps correctly |
| Runtime start with fakes does not throw | Task 26: `runtime.test.ts` — migration + recovery called on startup |
| End-to-end poll→enqueue→pipeline→facade | Task 27: `analysis-pipeline.test.ts` — integrated flow reaches draft_ready |
| Fetch failure → `fetch_failed` + cred cleanup | Task 28: `failure-recovery.test.ts` — `prepareSource` throws, job fails, cleanup called |
| Materialize failure → remote-evidence fallback | Task 28: `failure-recovery.test.ts` — `prepareContext` throws, `remote-evidence-only` available via facade |
| Advisor failure → unavailable, auto-analysis continues | Task 28: `failure-recovery.test.ts` — advisor throws, pipeline succeeds with `advisorStatus: 'unavailable'` |
| Agent timeout/malformed → seal + cleanup + retry only | Task 28: `failure-recovery.test.ts` — agent throws, run sealed, only `requestRetry` creates new attempt |
| Fetch failure keeps item tracked (`fetch_failed`) | Task 28: `failure-recovery.test.ts` — job failed, still in `getAllTracked` |
| Materialize failure offers remote-evidence-only recovery | Task 28: `failure-recovery.test.ts` — `materialize_failed` + `requestAnalyze` hint; no silent downgrade |
| Advisor unavailable does not cancel auto | Task 28: `failure-recovery.test.ts` — `advisor_status=unavailable`, `analysis_mode` unchanged, queued auto job intact |
| Agent failure seals + cleanup; retry only via requestRetry | Task 28: `failure-recovery.test.ts` — `sealRun` + `cleanupSourcePair`; `createRetryAttempt` not auto-called |

---

## Self-Review Checklist

- [x] **§10.4 Attention advisor:** Tasks 6–10 — candidate bounds, metadata-only inputs, batch/per-PR staleness, Advisor order, `not_scheduled`, advice never enqueues analysis.
- [x] **§10.5 Orchestrator:** Tasks 1–5 — attention/job/run states, CAS transitions, pre-context job identity, run-input hash, restart recovery.
- [x] **§10.6 Source manager:** Tasks 11–13 — fetch vs materialize credential boundary, no-checkout admin worktree, remote-evidence-only path.
- [x] **§10.7 Context builder:** Tasks 14–17 — nine-layer manifest (attention layers 4/5/7 empty), `pv_` provenance, coverage, create-once/seal.
- [x] **§10.8 Cursor adapter:** Tasks 18–20 — exact argv, NDJSON, model mismatch failure, worker pool, review schema/provenance validation.
- [x] **Protect-inputs hook:** Task 21 — fail-closed `beforeReadFile` using compiled matcher artifact.
- [x] **§2 outcomes 1–3 integration path:** Tasks 22–27 — work graph projection, auto/on_demand enqueue with supersession, full pipeline executor, OrchestratorFacade for Plan 04, daemon runtime lifecycle, end-to-end integration tests covering poll→policy→enqueue→pipeline→facade→recovery.
- [x] **§12 Source / advisor / agent failure:** Task 28 — `fetch_failed` seals run, cleans up source/admin, item remains in All Tracked; `materialize_failed` with explicit `facade.requestAnalyze({sourceMode:'remote-evidence-only'})` recovery (no silent downgrade); advisor failure marks `advisorStatus: 'unavailable'` without changing `analysisMode` or blocking pipeline; agent timeout/malformed seals failed run via `cleanupSourcePair`, only `requestRetry` creates new attempt.
- [x] **Type consistency:** Prerequisites use plan 02's flat `PolicyDecision` / `SelectedDomain`; `computePolicyDecisionHash` hashes that flat shape. SQL `policy_hash` ↔ TS `policyDecisionHash` mapping documented. All timestamps are ISO 8601 TEXT.
