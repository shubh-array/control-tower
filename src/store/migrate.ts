import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

const LEGACY_TABLES = ["attention_items", "advisor_runs", "learning_signals"];

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

function loadMigrationFiles(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((f) => {
    const match = /^(\d+)_(.+)\.sql$/.exec(f);
    if (!match) throw new Error(`Invalid migration filename: ${f}`);
    return {
      version: parseInt(match[1]!, 10),
      name: `${match[1]}_${match[2]}`,
      sql: readFileSync(join(MIGRATIONS_DIR, f), "utf-8"),
    };
  });
}

export function getCurrentVersion(db: Database.Database): number {
  const tableExists = db
    .prepare(
      "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get() as { cnt: number };

  if (tableExists.cnt === 0) return 0;

  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_migrations")
    .get() as { v: number | null };

  return row.v ?? 0;
}

export function assertReviewCoreSchema(db: Database.Database): void {
  const legacy = db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name IN (${LEGACY_TABLES.map(() => "?").join(",")})`,
  ).all(...LEGACY_TABLES) as Array<{ name: string }>;

  if (legacy.length > 0) {
    throw new Error(
      "Legacy Control Tower data detected; run `pnpm ct reset --all --yes`, then `pnpm ct init` before starting this version.",
    );
  }
}

export function runMigrations(db: Database.Database): void {
  const migrations = loadMigrationFiles();
  const current = getCurrentVersion(db);

  const pending = migrations.filter((m) => m.version > current);
  if (pending.length > 0) {
    for (const migration of pending) {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
      ).run(migration.version, migration.name);
    }
  }

  assertReviewCoreSchema(db);
}
