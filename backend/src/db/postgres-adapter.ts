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

    // Toggle string literal tracking on unescaped single quotes
    if (ch === "'" && (i === 0 || sql[i - 1] !== "'")) {
      inString = !inString;
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

  constructor(poolOrClient?: pg.Pool | pg.PoolClient) {
    this.poolOverride = poolOrClient;
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
    const pool = await getAppDb();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txDb = new PostgresAdapter(client);
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
