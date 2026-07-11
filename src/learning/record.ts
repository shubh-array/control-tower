import type Database from 'better-sqlite3';
import { parseSignal, type LearningSignal } from './signals.js';

export class SignalRecorder {
  constructor(private db: Database.Database) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        job_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        policy_decision_hash TEXT NOT NULL,
        run_input_hash TEXT NOT NULL,
        model_role TEXT NOT NULL,
        model_spec_hash TEXT NOT NULL,
        harness_manifest_hash TEXT NOT NULL,
        context_hash TEXT NOT NULL,
        provenance_schema_version INTEGER NOT NULL,
        source_mode TEXT NOT NULL,
        payload TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_job_id ON learning_signals(job_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_run_id ON learning_signals(run_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_model_role ON learning_signals(model_role)`);
  }

  record(signal: LearningSignal): void {
    const parsed = parseSignal(signal);
    if (!parsed.success) {
      throw new Error(`Invalid signal: ${parsed.error.message}`);
    }
    const stmt = this.db.prepare(`
      INSERT INTO learning_signals
        (type, timestamp, job_id, run_id, policy_decision_hash, run_input_hash,
         model_role, model_spec_hash, harness_manifest_hash, context_hash,
         provenance_schema_version, source_mode, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      signal.type,
      signal.timestamp,
      signal.jobId,
      signal.runId,
      signal.policyDecisionHash,
      signal.runInputHash,
      signal.modelRole,
      signal.modelSpecHash,
      signal.harnessManifestHash,
      signal.contextHash,
      signal.provenanceSchemaVersion,
      signal.sourceMode,
      JSON.stringify(signal),
    );
  }

  queryByJobId(jobId: string): LearningSignal[] {
    const rows = this.db.prepare(
      'SELECT payload FROM learning_signals WHERE job_id = ? ORDER BY id ASC'
    ).all(jobId) as { payload: string }[];
    return rows.map(r => JSON.parse(r.payload));
  }

  queryByRunId(runId: string): LearningSignal[] {
    const rows = this.db.prepare(
      'SELECT payload FROM learning_signals WHERE run_id = ? ORDER BY id ASC'
    ).all(runId) as { payload: string }[];
    return rows.map(r => JSON.parse(r.payload));
  }

  queryByRole(role: 'attention' | 'primaryReview'): LearningSignal[] {
    const rows = this.db.prepare(
      'SELECT payload FROM learning_signals WHERE model_role = ? ORDER BY id ASC'
    ).all(role) as { payload: string }[];
    return rows.map(r => JSON.parse(r.payload));
  }

  queryRecent(limit: number): LearningSignal[] {
    const rows = this.db.prepare(
      'SELECT payload FROM learning_signals ORDER BY id DESC LIMIT ?'
    ).all(limit) as { payload: string }[];
    return rows.map(r => JSON.parse(r.payload));
  }
}
