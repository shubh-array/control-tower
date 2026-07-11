-- Projection columns for WorkGraph and policy persistence (Plan 03)

ALTER TABLE attention_items ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE attention_items ADD COLUMN policy_hash TEXT;

ALTER TABLE prs ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]';
