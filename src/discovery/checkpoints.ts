import type Database from "better-sqlite3";

export interface Checkpoint {
  id: string;
  host: string;
  checkpoint: string;
  freshnessAt: string | null;
  healthy: boolean;
  updatedAt: string;
}

export class CheckpointStore {
  constructor(private readonly db: Database.Database) {}

  get(id: string): string | null {
    const row = this.db
      .prepare("SELECT checkpoint FROM discovery_checkpoints WHERE id = ?")
      .get(id) as { checkpoint: string } | undefined;
    return row?.checkpoint ?? null;
  }

  set(
    id: string,
    host: string,
    checkpoint: string,
    opts?: { freshnessAt?: string | null; healthy?: boolean },
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO discovery_checkpoints (
        id, host, checkpoint, freshness_at, healthy, updated_at
      )
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(id) DO UPDATE SET
        host = excluded.host,
        checkpoint = excluded.checkpoint,
        freshness_at = excluded.freshness_at,
        healthy = excluded.healthy,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        id,
        host,
        checkpoint,
        opts?.freshnessAt ?? null,
        opts?.healthy === false ? 0 : 1,
      );
  }

  getLastPollTime(host: string): string | null {
    return this.get(`poll:${host}:lastCompleted`);
  }

  setLastPollTime(host: string): void {
    const now = new Date().toISOString();
    this.set(`poll:${host}:lastCompleted`, host, now, { freshnessAt: now });
  }

  getPageCursor(host: string, query: string): string | null {
    return this.get(`cursor:${host}:${query}`);
  }

  setPageCursor(host: string, query: string, cursor: string): void {
    this.set(`cursor:${host}:${query}`, host, cursor);
  }

  clearPageCursor(host: string, query: string): void {
    this.db
      .prepare("DELETE FROM discovery_checkpoints WHERE id = ?")
      .run(`cursor:${host}:${query}`);
  }
}
