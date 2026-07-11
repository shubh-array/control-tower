// tests/e2e/fake-adapters.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  startRuntime,
  stopRuntime,
  type RuntimeDeps,
  type RuntimeHandle,
} from '../../src/daemon/runtime.js';
import {
  createOrchestratorFacade,
  type OrchestratorFacade,
  type FacadeDeps,
} from '../../src/orchestrator/facade.js';

interface FakeGhResponse {
  prs: Array<{ number: number; title: string; headSha: string; author: string; changedFiles: string[] }>;
  reviewRequests: Array<{ number: number; repo: string }>;
}

class FakeGhAdapter {
  public calls: Array<{ method: string; args: unknown[] }> = [];
  private responses: FakeGhResponse;

  constructor(responses: FakeGhResponse) {
    this.responses = responses;
  }

  async listPRs(repo: string): Promise<FakeGhResponse['prs']> {
    this.calls.push({ method: 'listPRs', args: [repo] });
    return this.responses.prs;
  }

  async getReviewRequests(login: string): Promise<FakeGhResponse['reviewRequests']> {
    this.calls.push({ method: 'getReviewRequests', args: [login] });
    return this.responses.reviewRequests;
  }

  async submitReview(_repo: string, _pr: number, _body: string, _event: string): Promise<{ id: number }> {
    this.calls.push({ method: 'submitReview', args: [_repo, _pr, _body, _event] });
    return { id: 12345 };
  }
}

class FakeGitAdapter {
  public calls: Array<{ method: string; args: unknown[] }> = [];
  private refs: Record<string, string> = {};

  setRef(ref: string, sha: string) { this.refs[ref] = sha; }

  async fetch(_remote: string, _refspec: string): Promise<void> {
    this.calls.push({ method: 'fetch', args: [_remote, _refspec] });
  }

  async resolveRef(ref: string): Promise<string> {
    this.calls.push({ method: 'resolveRef', args: [ref] });
    return this.refs[ref] ?? 'deadbeef'.repeat(5);
  }

  async catFile(sha: string): Promise<Buffer> {
    this.calls.push({ method: 'catFile', args: [sha] });
    return Buffer.from(`content-of-${sha}`);
  }
}

interface FakeCursorOutput {
  schemaVersion: number;
  summary: { intent: string; implementation: string };
  observations: Array<{ type: string; statement: string; provenanceRefs: string[] }>;
  findings: Array<{ severity: string; title: string; observationIndexes: number[] }>;
  recommendedDisposition: string;
  draftSummary: { body: string; observationIndexes: number[]; provenanceRefs: string[] };
}

class FakeCursorAdapter {
  public calls: Array<{ prompt: string; model: string }> = [];
  private output: FakeCursorOutput;

  constructor(output: FakeCursorOutput) {
    this.output = output;
  }

  async run(prompt: string, model: string): Promise<{ exitCode: number; output: FakeCursorOutput }> {
    this.calls.push({ prompt, model });
    return { exitCode: 0, output: this.output };
  }
}

class FakePublisher {
  public published: Array<{ repo: string; pr: number; event: string; body: string }> = [];
  public enabled = false;

  async publish(repo: string, pr: number, event: string, body: string): Promise<{ success: boolean }> {
    if (!this.enabled) throw new Error('Publisher disabled in shadow mode');
    this.published.push({ repo, pr, event, body });
    return { success: true };
  }
}

const PR_SHA = 'abc123'.padEnd(40, '0');

async function runFakePipeline(
  jobId: string,
  _runId: string,
  cursor: FakeCursorAdapter,
  jobs: Map<string, { state: string; runIds: string[]; prNumber: number; repositoryKey: string }>,
  drafts: Map<string, FakeCursorOutput>,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.state = 'preparing_context';
  job.state = 'preparing_source';
  job.state = 'running_agent';

  const agentResult = await cursor.run(`Review PR #${job.prNumber}`, 'claude-sonnet-4-20250514');
  if (agentResult.exitCode !== 0) {
    job.state = 'failed';
    return;
  }

  job.state = 'validating_output';
  job.state = 'draft_ready';
  drafts.set(jobId, agentResult.output);
}

function buildFakeDeps(opts: {
  gh: FakeGhAdapter;
  git: FakeGitAdapter;
  cursor: FakeCursorAdapter;
  publisher: FakePublisher;
  db: Database.Database;
}): RuntimeDeps {
  let jobCounter = 0;
  let runCounter = 0;
  const jobs = new Map<string, { state: string; runIds: string[]; prNumber: number; repositoryKey: string }>();
  const drafts = new Map<string, FakeCursorOutput>();

  return {
    migrate() {
      opts.db.exec('CREATE TABLE IF NOT EXISTS e2e_jobs (id TEXT PRIMARY KEY, state TEXT)');
    },
    recoverOrphanedStates() {
      return {
        failedJobs: [], failedRuns: [], failedAdvisorRuns: [],
        autoRetried: [], failureReasons: new Map(), publishingReconciled: [],
      };
    },
    startDiscoveryPoller() {
      return { stop() {} };
    },
    runSchedulerTick() {
      const jobsToStart: string[] = [];
      for (const [id, job] of jobs) {
        if (job.state === 'queued') {
          jobsToStart.push(id);
        }
      }
      return { jobsToStart, reason: jobsToStart.length > 0 ? 'eligible' : 'none' };
    },
    runAttentionBatch() {},
    createFacade(): OrchestratorFacade {
      const facadeDeps: FacadeDeps = {
        getAllTracked: () => [],
        getFocusQueue: () => ({ now: [], next: [], monitor: [] }),
        getJob: (id) => {
          const j = jobs.get(id);
          if (!j) return null;
          return {
            jobId: id,
            repository: j.repositoryKey,
            prNumber: j.prNumber,
            headSha: PR_SHA,
            state: j.state,
            sourceMode: 'registered-source',
            runs: j.runIds.map((rid, i) => ({
              runId: rid,
              attemptNumber: i + 1,
              state: j.state === 'draft_ready' ? 'completed' : 'running',
              startedAt: new Date().toISOString(),
              completedAt: j.state === 'draft_ready' ? new Date().toISOString() : null,
            })),
            acceptedRunId: j.state === 'draft_ready' ? (j.runIds[j.runIds.length - 1] ?? null) : null,
          };
        },
        getDraft: (jobId) => {
          const d = drafts.get(jobId);
          if (!d) return null;
          return {
            jobId,
            runId: jobs.get(jobId)!.runIds[0] ?? '',
            summary: d.summary,
            draftSummary: d.draftSummary,
            findings: d.findings as never[],
            observations: d.observations as never[],
            checks: [],
            coverage: { mode: 'full', sourceTreeInspected: true, diffFiltered: true, omittedProtectedPaths: [], missingCoverage: [] },
            unknowns: [],
            recommendedDisposition: d.recommendedDisposition,
            validatedProvenance: [],
            operationPlan: null,
          };
        },
        getHealthStatus: () => ({ activeJobs: 0, queuedJobs: 0, failedJobsLast24h: 0, uptime: 100, lastPollTimestamp: '2026-07-10T00:00:00.000Z' }),
        getAuditTrail: () => [],
        enqueueAnalysis(input) {
          const jid = `job_${++jobCounter}`;
          const rid = `run_${++runCounter}`;
          jobs.set(jid, { state: 'queued', runIds: [rid], prNumber: input.prNumber, repositoryKey: input.repositoryKey });
          void runFakePipeline(jid, rid, opts.cursor, jobs, drafts);
          return jid;
        },
        enqueueRetry(jobId) {
          const rid = `run_${++runCounter}`;
          const j = jobs.get(jobId);
          if (j) {
            j.runIds.push(rid);
            j.state = 'queued';
            void runFakePipeline(jobId, rid, opts.cursor, jobs, drafts);
          }
          return rid;
        },
        scheduleAdvice() {},
        enqueuedJobs: [],
      };
      return createOrchestratorFacade(facadeDeps);
    },
  };
}

describe('End-to-End via OrchestratorFacade with Fake Adapters', () => {
  let db: Database.Database;
  let gh: FakeGhAdapter;
  let git: FakeGitAdapter;
  let cursor: FakeCursorAdapter;
  let publisher: FakePublisher;
  let handle: RuntimeHandle;

  beforeEach(async () => {
    db = new Database(':memory:');
    gh = new FakeGhAdapter({
      prs: [
        { number: 100, title: 'Add feature X', headSha: PR_SHA, author: 'dev1', changedFiles: ['src/feature.ts'] },
      ],
      reviewRequests: [{ number: 100, repo: 'pba-webapp' }],
    });
    git = new FakeGitAdapter();
    git.setRef('refs/pull/100/head', PR_SHA);
    cursor = new FakeCursorAdapter({
      schemaVersion: 1,
      summary: { intent: 'Add feature X', implementation: 'New module' },
      observations: [{ type: 'observation', statement: 'Uses proper error handling', provenanceRefs: ['pv_diff_hunk_001'] }],
      findings: [],
      recommendedDisposition: 'approve',
      draftSummary: { body: 'LGTM - clean implementation', observationIndexes: [0], provenanceRefs: ['pv_diff_hunk_001'] },
    });
    publisher = new FakePublisher();

    handle = await startRuntime(
      { port: 0, schedulerIntervalMs: 60_000, attentionIntervalMs: 60_000, dataDirectory: ':memory:', apiServerEnabled: false },
      buildFakeDeps({ gh, git, cursor, publisher, db }),
    );
  });

  afterEach(async () => {
    await stopRuntime(handle);
    db.close();
  });

  it('reaches draft_ready via facade.requestAnalyze and retrieves draft via facade.getDraft', async () => {
    const facade = handle.facade;

    const jobId = facade.requestAnalyze({
      repositoryKey: 'org/pba-webapp',
      prNumber: 100,
    });
    expect(jobId).toMatch(/^job_/);

    await new Promise(r => setTimeout(r, 10));

    const job = facade.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job!.prNumber).toBe(100);
    expect(job!.state).toBe('draft_ready');
    expect(job!.acceptedRunId).toMatch(/^run_/);

    const draft = facade.getDraft(jobId);
    expect(draft).not.toBeNull();
    expect(draft!.recommendedDisposition).toBe('approve');
    expect(draft!.draftSummary.body).toBe('LGTM - clean implementation');
    expect(cursor.calls).toHaveLength(1);
  });

  it('publisher rejects publication in shadow mode', async () => {
    await expect(
      publisher.publish('pba-webapp', 100, 'APPROVE', ''),
    ).rejects.toThrow('Publisher disabled in shadow mode');
    expect(publisher.published).toHaveLength(0);
  });

  it('publisher succeeds when enabled (gated mode)', async () => {
    publisher.enabled = true;
    const result = await publisher.publish('pba-webapp', 100, 'COMMENT', 'LGTM');
    expect(result.success).toBe(true);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]!.event).toBe('COMMENT');
  });

  it('facade.requestRetry creates a new run for an existing job', async () => {
    const facade = handle.facade;
    const jobId = facade.requestAnalyze({
      repositoryKey: 'org/pba-webapp',
      prNumber: 100,
    });
    await new Promise(r => setTimeout(r, 10));

    const newRunId = facade.requestRetry(jobId);
    expect(newRunId).toMatch(/^run_/);
    await new Promise(r => setTimeout(r, 10));

    const job = facade.getJob(jobId);
    expect(job!.runs).toHaveLength(2);
    expect(job!.state).toBe('draft_ready');
  });

  it('fake Git adapter provides deterministic blob content', async () => {
    const content = await git.catFile('blob_sha_123');
    expect(content.toString()).toBe('content-of-blob_sha_123');
  });
});
