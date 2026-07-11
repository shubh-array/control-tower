import type Database from "better-sqlite3";
import {
  type JobState,
  ALLOWED_JOB_TRANSITIONS,
  isTerminalJob,
} from "./job-state.js";
import {
  type RunState,
  ALLOWED_RUN_TRANSITIONS,
  isTerminalRun,
  type AdvisorRunState,
  ALLOWED_ADVISOR_TRANSITIONS,
} from "./run-state.js";

export class TransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
    public readonly from: string,
    public readonly to: string,
    public readonly reason: string,
  ) {
    super(
      `Transition ${entity} ${id}: ${from} -> ${to} rejected: ${reason}`,
    );
    this.name = "TransitionError";
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

export function transitionJob(
  db: Database.Database,
  req: JobTransitionRequest,
): TransitionResult {
  return db.transaction(() => {
    const row = db
      .prepare("SELECT id, state, version FROM jobs WHERE id = ?")
      .get(req.jobId) as
      | { id: string; state: JobState; version: number }
      | undefined;

    if (!row) {
      throw new TransitionError(
        "job",
        req.jobId,
        req.expectedState,
        req.newState,
        "job not found",
      );
    }

    if (req.idempotencyKey && row.state === req.newState) {
      return { success: true, newVersion: row.version, alreadyApplied: true };
    }

    if (row.state !== req.expectedState) {
      throw new TransitionError(
        "job",
        req.jobId,
        req.expectedState,
        req.newState,
        `current state is ${row.state}, expected ${req.expectedState}`,
      );
    }
    if (row.version !== req.expectedVersion) {
      throw new TransitionError(
        "job",
        req.jobId,
        req.expectedState,
        req.newState,
        `current version is ${row.version}, expected ${req.expectedVersion}`,
      );
    }

    if (isTerminalJob(row.state)) {
      throw new TransitionError(
        "job",
        req.jobId,
        row.state,
        req.newState,
        "terminal state is immutable",
      );
    }

    if (row.state === "failed" && req.newState === "queued" && !req.manualRetry) {
      throw new TransitionError(
        "job",
        req.jobId,
        row.state,
        req.newState,
        "failed -> queued requires explicit manualRetry",
      );
    }

    const allowed = ALLOWED_JOB_TRANSITIONS.get(row.state);
    if (!allowed?.has(req.newState)) {
      throw new TransitionError(
        "job",
        req.jobId,
        row.state,
        req.newState,
        "transition not in allowed graph",
      );
    }

    const newVersion = row.version + 1;
    db.prepare(
      "UPDATE jobs SET state = ?, version = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND version = ?",
    ).run(
      req.newState,
      newVersion,
      req.failureReason ?? null,
      new Date().toISOString(),
      req.jobId,
      row.version,
    );
    return { success: true, newVersion };
  })();
}

export interface RunTransitionRequest {
  runId: string;
  expectedState: RunState;
  expectedVersion: number;
  newState: RunState;
}

export function transitionRun(
  db: Database.Database,
  req: RunTransitionRequest,
): TransitionResult {
  return db.transaction(() => {
    const row = db
      .prepare("SELECT id, state, version FROM runs WHERE id = ?")
      .get(req.runId) as
      | { id: string; state: RunState; version: number }
      | undefined;

    if (!row) {
      throw new TransitionError(
        "run",
        req.runId,
        req.expectedState,
        req.newState,
        "run not found",
      );
    }
    if (row.state !== req.expectedState || row.version !== req.expectedVersion) {
      throw new TransitionError(
        "run",
        req.runId,
        req.expectedState,
        req.newState,
        `compare-and-set mismatch: state=${row.state} version=${row.version}`,
      );
    }
    if (isTerminalRun(row.state)) {
      throw new TransitionError(
        "run",
        req.runId,
        row.state,
        req.newState,
        "terminal state is immutable",
      );
    }
    const allowed = ALLOWED_RUN_TRANSITIONS.get(row.state);
    if (!allowed?.has(req.newState)) {
      throw new TransitionError(
        "run",
        req.runId,
        row.state,
        req.newState,
        "transition not in allowed graph",
      );
    }
    const newVersion = row.version + 1;
    db.prepare(
      "UPDATE runs SET state = ?, version = ? WHERE id = ? AND version = ?",
    ).run(req.newState, newVersion, req.runId, row.version);
    return { success: true, newVersion };
  })();
}

export interface AdvisorTransitionRequest {
  runId: string;
  expectedState: AdvisorRunState;
  expectedVersion: number;
  newState: AdvisorRunState;
}

export function transitionAdvisorRun(
  db: Database.Database,
  req: AdvisorTransitionRequest,
): TransitionResult {
  return db.transaction(() => {
    const row = db
      .prepare("SELECT id, state, version FROM advisor_runs WHERE id = ?")
      .get(req.runId) as
      | { id: string; state: AdvisorRunState; version: number }
      | undefined;

    if (!row) {
      throw new TransitionError(
        "advisor_run",
        req.runId,
        req.expectedState,
        req.newState,
        "run not found",
      );
    }
    if (row.state !== req.expectedState || row.version !== req.expectedVersion) {
      throw new TransitionError(
        "advisor_run",
        req.runId,
        req.expectedState,
        req.newState,
        `compare-and-set mismatch: state=${row.state} version=${row.version}`,
      );
    }
    const allowed = ALLOWED_ADVISOR_TRANSITIONS.get(row.state);
    if (!allowed?.has(req.newState)) {
      throw new TransitionError(
        "advisor_run",
        req.runId,
        row.state,
        req.newState,
        "transition not in allowed graph",
      );
    }
    const newVersion = row.version + 1;
    db.prepare(
      "UPDATE advisor_runs SET state = ?, version = ? WHERE id = ? AND version = ?",
    ).run(req.newState, newVersion, req.runId, row.version);
    return { success: true, newVersion };
  })();
}
