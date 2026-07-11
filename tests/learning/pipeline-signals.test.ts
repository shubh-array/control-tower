import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignalRecorder } from '../../src/learning/record.js';
import { buildPipelineDeps, runPipelineForJob } from '../../src/orchestrator/pipeline-runner.js';
import { executePipeline, type PipelineJob } from '../../src/orchestrator/pipeline.js';
import { openDatabase } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';

describe('pipeline signal hooks (production wiring)', () => {
  let db: Database.Database;
  let recorder: SignalRecorder;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ct-pipeline-signals-'));
    db = openDatabase(join(dataDir, 'test.sqlite'));
    runMigrations(db);
    recorder = new SignalRecorder(db);
    recorder.initialize();

    db.prepare(
      `INSERT INTO jobs (
        id, identity_hash, repository_key, pr_number, head_sha, source_mode,
        policy_hash, state, version, queued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?)`,
    ).run(
      'job-signal-1',
      'identity-1',
      'pba-webapp',
      42,
      'a'.repeat(40),
      'remote-evidence-only',
      'policy-hash-1',
      new Date(Date.now() - 5000).toISOString(),
    );
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('records timing and disposition signals when pipeline succeeds', async () => {
    const job: PipelineJob = {
      id: 'job-signal-1',
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      sourceMode: 'remote-evidence-only',
      policyHash: 'policy-hash-1',
      identityHash: 'identity-1',
      version: 1,
    };

    const deps = buildPipelineDeps(db, {
      dataDirectory: dataDir,
      signalRecorder: recorder,
      modelSpecHash: 'model-spec-hash',
    }, job.id);
    deps.validateOutput = () => ({ valid: true, errors: [], validatedProvenance: [] });
    deps.sealRun = async () => ({ sealed: true });

    const result = await executePipeline(deps, job);
    expect(result.success).toBe(true);

    const signals = recorder.queryByJobId('job-signal-1');
    expect(signals.map((s) => s.type)).toEqual(['timing', 'disposition']);
    expect(signals[0]?.type).toBe('timing');
    if (signals[1]?.type === 'disposition') {
      expect(signals[1].finalDisposition).toBe('no_publication');
    }
  });

  it('records failure signal when pipeline agent validation fails', async () => {
    db.prepare(`UPDATE jobs SET source_mode = 'registered-source' WHERE id = ?`).run('job-signal-1');

    const job: PipelineJob = {
      id: 'job-signal-1',
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'a'.repeat(40),
      sourceMode: 'registered-source',
      policyHash: 'policy-hash-1',
      identityHash: 'identity-1',
      version: 1,
    };

    await runPipelineForJob(db, {
      dataDirectory: dataDir,
      signalRecorder: recorder,
      modelSpecHash: 'model-spec-hash',
    }, job.id);

    const signals = recorder.queryByJobId('job-signal-1');
    expect(signals.some((s) => s.type === 'failure')).toBe(true);
  });
});
