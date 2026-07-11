// tests/orchestrator/enqueue.test.ts
import { describe, it, expect } from 'vitest';
import {
  enqueueFromPolicyDecision,
  type EnqueueDeps,
  type EnqueueInput,
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
    findActiveJobByIdentity(_identityHash: string) {
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
    supersede(jobId: string, _version: number) {
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
