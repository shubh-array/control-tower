-- Control Tower review-core schema
-- Table name is `prs` (never `pull_requests`). Timestamps are ISO TEXT.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  applied   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE repositories (
  id              TEXT PRIMARY KEY,
  github_identity TEXT NOT NULL UNIQUE,
  github_host     TEXT NOT NULL DEFAULT 'github.com',
  github_owner    TEXT NOT NULL,
  github_repo     TEXT NOT NULL,
  default_branch  TEXT NOT NULL,
  resource_class  TEXT NOT NULL CHECK (resource_class IN ('light', 'medium', 'heavy')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE prs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id       TEXT    NOT NULL REFERENCES repositories(id),
  pr_number           INTEGER NOT NULL,
  head_sha            TEXT    NOT NULL,
  base_sha            TEXT    NOT NULL,
  title               TEXT    NOT NULL,
  url                 TEXT    NOT NULL,
  author_login        TEXT    NOT NULL,
  explicit_request    INTEGER NOT NULL DEFAULT 0,
  explicit_request_at TEXT,
  github_updated      TEXT    NOT NULL,
  fetched_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  policy_json         TEXT    NOT NULL,
  policy_hash         TEXT    NOT NULL,
  UNIQUE (repository_id, pr_number)
);

CREATE TABLE pr_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id       INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  conclusion  TEXT,
  details_url TEXT,
  UNIQUE (pr_id, name)
);

CREATE TABLE pr_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id         INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  author_login  TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  url           TEXT
);

CREATE TABLE discovery_checkpoints (
  id            TEXT PRIMARY KEY,
  host          TEXT NOT NULL,
  checkpoint    TEXT NOT NULL,
  freshness_at  TEXT,
  healthy       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE jobs (
  id                       TEXT PRIMARY KEY,
  identity_hash            TEXT    NOT NULL UNIQUE,
  repository_id            TEXT,
  repository_key           TEXT    NOT NULL,
  pr_number                INTEGER NOT NULL,
  head_sha                 TEXT    NOT NULL,
  source_mode              TEXT    NOT NULL CHECK (source_mode IN ('registered-source', 'remote-evidence-only')),
  policy_hash              TEXT    NOT NULL,
  state                    TEXT    NOT NULL CHECK (state IN (
    'queued', 'preparing_context', 'preparing_source', 'running_agent',
    'validating_output', 'draft_ready', 'awaiting_approval',
    'publishing', 'published', 'failed', 'cancelled', 'superseded'
  )),
  version                  INTEGER NOT NULL DEFAULT 1,
  failure_reason           TEXT,
  priority_sort_ordinal    INTEGER NOT NULL DEFAULT 3,
  explicit_request_sort    INTEGER NOT NULL DEFAULT 1,
  queue_timestamp          TEXT,
  queued_at                TEXT,
  latest_run_id            TEXT,
  accepted_run_id          TEXT,
  created_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE runs (
  id              TEXT    PRIMARY KEY,
  job_id          TEXT    NOT NULL REFERENCES jobs(id),
  attempt_number  INTEGER NOT NULL,
  run_input_hash  TEXT    NOT NULL,
  state           TEXT    NOT NULL CHECK (state IN (
    'allocated', 'running', 'validating', 'succeeded', 'failed',
    'cancelled', 'superseded'
  )),
  version         INTEGER NOT NULL DEFAULT 1,
  failure_reason  TEXT,
  manifest_hash   TEXT,
  model_id        TEXT,
  started_at      TEXT,
  sealed_at       TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT    NOT NULL,
  entity_id   TEXT    NOT NULL,
  event       TEXT    NOT NULL,
  details     TEXT    NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_prs_repo_number ON prs (repository_id, pr_number);
CREATE INDEX idx_pr_checks_pr ON pr_checks (pr_id);
CREATE INDEX idx_jobs_repo_pr ON jobs (repository_key, pr_number);
CREATE INDEX idx_jobs_state ON jobs (state);
CREATE INDEX idx_jobs_identity ON jobs (identity_hash);
CREATE INDEX idx_runs_job ON runs (job_id);
CREATE INDEX idx_audit_entity ON audit_events (entity_type, entity_id);
