/**
 * SQLite adapter for the AppDb interface.
 * Wraps synchronous better-sqlite3 calls in async methods.
 */
import type { AppDb, QueryResult } from './app-db.js';
import { getDb } from './sqlite.js';

export class SqliteAdapter implements AppDb {
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = getDb();
    return db.prepare(sql).all(...params) as T[];
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const db = getDb();
    const row = db.prepare(sql).get(...params) as T | undefined;
    return row ?? null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const db = getDb();
    const result = db.prepare(sql).run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  async transaction<T>(fn: (db: AppDb) => Promise<T>): Promise<T> {
    // better-sqlite3 transactions are synchronous, but our interface is async.
    // We use a simple approach: run the callback and rely on SQLite's
    // serialized write model. For SQLite, we wrap in a begin/commit manually
    // since the callback is async and can't use db.transaction() directly.
    const db = getDb();
    db.exec('BEGIN');
    try {
      const result = await fn(this);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const db = getDb();
      const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
      return row?.ok === 1;
    } catch {
      return false;
    }
  }
}
