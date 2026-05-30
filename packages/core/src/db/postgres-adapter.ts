/**
 * PostgreSQL adapter for the AppDb interface.
 * Wraps pg.Pool with automatic `?` → `$1, $2, $3` parameter conversion.
 */
import type pg from 'pg';
import type { AppDb, QueryResult } from './app-db.js';
import { getAppDb } from './postgres.js';

/**
 * Convert `?` placeholders to PostgreSQL `$1, $2, $3` style.
 * Skips `?` inside single-quoted string literals and `??` (escaped question marks).
 */
export function convertPlaceholders(sql: string): string {
  let idx = 0;
  let inString = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'") {
      if (inString) {
        // Inside a string: '' is an escaped quote, not end-of-string
        if (sql[i + 1] === "'") {
          result += "''";
          i++; // skip next quote
          continue;
        }
        // Single quote ends the string
        inString = false;
      } else {
        inString = true;
      }
      result += ch;
      continue;
    }

    if (ch === '?' && !inString) {
      // Skip escaped ?? (literal question mark)
      if (sql[i + 1] === '?') {
        result += '?';
        i++; // skip next ?
        continue;
      }
      idx++;
      result += `$${idx}`;
    } else {
      result += ch;
    }
  }

  return result;
}

export class PostgresAdapter implements AppDb {
  private poolOverride?: pg.Pool | pg.PoolClient;
  /** True when poolOverride is a PoolClient (not a Pool). */
  private isClient: boolean;

  constructor(poolOrClient?: pg.Pool | pg.PoolClient, isClient = false) {
    this.poolOverride = poolOrClient;
    this.isClient = isClient;
  }

  private async getPool(): Promise<pg.Pool | pg.PoolClient> {
    if (this.poolOverride) return this.poolOverride;
    return getAppDb();
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.getPool();
    const pgSql = convertPlaceholders(sql);
    const { rows } = await pool.query(pgSql, params);
    return rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const pool = await this.getPool();
    const pgSql = convertPlaceholders(sql);
    const result = await pool.query(pgSql, params);
    return {
      changes: result.rowCount ?? 0,
    };
  }

  async transaction<T>(fn: (db: AppDb) => Promise<T>): Promise<T> {
    const poolOrClient = await this.getPool();

    if (this.isClient) {
      // Already a PoolClient (e.g. nested transaction) — run inline with savepoint
      await (poolOrClient as pg.PoolClient).query('BEGIN');
      try {
        const result = await fn(this);
        await (poolOrClient as pg.PoolClient).query('COMMIT');
        return result;
      } catch (err) {
        await (poolOrClient as pg.PoolClient).query('ROLLBACK');
        throw err;
      }
    }

    const client = await (poolOrClient as pg.Pool).connect();
    try {
      await client.query('BEGIN');
      const txDb = new PostgresAdapter(client, true);
      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pool = await this.getPool();
      const { rows } = await pool.query('SELECT 1 as ok');
      return rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }
}
