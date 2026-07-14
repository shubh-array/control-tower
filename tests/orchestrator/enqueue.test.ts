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

function makeDeps(existingJob?: { id: string; headSha: string; policyHash: string; sourceMode: string; state: string; repositoryKey?: string; prNumber?: number; identityHash?: string }): EnqueueDeps {
  const jobs = new Map<string, Record<string, unknown>>();
  if (existingJob) {
    jobs.set(existingJob.id, {
      id: existingJob.id,
      head_sha: existingJob.headSha,
      policy_hash: existingJob.policyHash,
      source_mode: existingJob.sourceMode,
      state: existingJob.state,
      version: 1,
      repository_key: existingJob.repositoryKey ?? 'pba-webapp',
      pr_number: existingJob.prNumber ?? 42,
      identity_hash: existingJob.identityHash ?? `hash-${existingJob.repositoryKey ?? 'pba-webapp'}-42-${existingJob.headSha}-${existingJob.policyHash}`,
    });
  }
  let nextId = 100;
  return {
    findActiveJobByIdentity(identityHash: string) {
      for (const [, job] of jobs) {
        if (
          job.identity_hash === identityHash &&
          !['published', 'cancelled', 'superseded'].includes(job.state as string)
        ) {
          return job as { id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number };
        }
      }
      return null;
    },
    findActiveJobsByPr(repositoryKey: string, prNumber: number) {
      const matches: Array<{ id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number }> = [];
      for (const [, job] of jobs) {
        if (
          job.repository_key === repositoryKey &&
          job.pr_number === prNumber &&
          !['superseded', 'cancelled', 'published', 'failed'].includes(job.state as string)
        ) {
          matches.push(job as { id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number });
        }
      }
      return matches;
    },
    insertJob(row: Record<string, unknown>) {
      const id = `job-${nextId++}`;
      jobs.set(id, {
        ...row,
        id,
        repository_key: row.repositoryKey,
        pr_number: row.prNumber,
        identity_hash: row.identityHash,
      });
      return id;
    },
    supersede(jobId: string, _version: number) {
      const j = jobs.get(jobId);
      if (j) j.state = 'superseded';
    },
    computeIdentityHash(input: Record<string, unknown>) {
      return `hash-${input.repositoryKey}-${input.prNumber}-${input.headSha}-${input.policyDecisionHash}`;
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
    manualRequest: false,
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

  it('enqueues on_demand author-only when manualRequest is true', () => {
    const deps = makeDeps();
    const input = makeInput({
      policy: stubPolicy({ analysisMode: 'on_demand', authorOnly: true }),
      explicitRequest: false,
      manualRequest: true,
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe('manual_request');
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
    expect(result.jobId).not.toBe('job-old');
    expect(result.reason).toBe('auto_enqueue');
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
    expect(result.jobId).not.toBe('job-old');
    expect(result.reason).toBe('auto_enqueue');
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

  it('reuses failed job identity without inserting duplicate', () => {
    const policy = stubPolicy({ analysisMode: 'auto' });
    const policyHash = 'policy-p1-auto';
    const deps = makeDeps({
      id: 'job-failed',
      headSha: 'a'.repeat(40),
      policyHash,
      sourceMode: 'registered-source',
      state: 'failed',
      identityHash: `hash-pba-webapp-42-${'a'.repeat(40)}-${policyHash}`,
    });
    const result = enqueueFromPolicyDecision(deps, makeInput({ policy }));

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('existing_job_current');
    expect(result.jobId).toBe('job-failed');
  });

  it('reuses existing job when nothing changed', () => {
    const policy = stubPolicy({ analysisMode: 'auto' });
    const policyHash = 'policy-p1-auto';
    const deps = makeDeps({
      id: 'job-old',
      headSha: 'a'.repeat(40),
      policyHash,
      sourceMode: 'registered-source',
      state: 'queued',
      identityHash: `hash-pba-webapp-42-${'a'.repeat(40)}-${policyHash}`,
    });
    const input = makeInput({ policy });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('existing_job_current');
    expect(result.jobId).toBe('job-old');
  });
});

describe('PR-scoped supersede', () => {
  it('supersedes prior active job for same PR when head SHA changes (PR-scoped)', () => {
    const jobs = new Map<string, Record<string, unknown>>();
    jobs.set('job-old', {
      id: 'job-old',
      repository_key: 'pba-webapp',
      pr_number: 42,
      head_sha: 'a'.repeat(40),
      policy_hash: 'policy-p1-auto',
      source_mode: 'registered-source',
      state: 'draft_ready',
      version: 1,
    });

    let nextId = 200;
    const deps: EnqueueDeps = {
      findActiveJobByIdentity(_identityHash: string) {
        return null;
      },
      findActiveJobsByPr(repositoryKey: string, prNumber: number) {
        const matches: Array<{ id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number }> = [];
        for (const [, job] of jobs) {
          if (
            job.repository_key === repositoryKey &&
            job.pr_number === prNumber &&
            !['superseded', 'cancelled', 'published', 'failed'].includes(job.state as string)
          ) {
            matches.push(job as { id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number });
          }
        }
        return matches;
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
        return `hash-${input.repositoryKey}-${input.prNumber}-${input.headSha}-${input.policyDecisionHash}`;
      },
      computePolicyHash(decision: PolicyDecision) {
        return `policy-${decision.priorityStatus}-${decision.analysisMode}`;
      },
    };

    const input = makeInput({
      headSha: 'b'.repeat(40),
      policy: stubPolicy({ analysisMode: 'auto' }),
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(jobs.get('job-old')?.state).toBe('superseded');
  });
});
