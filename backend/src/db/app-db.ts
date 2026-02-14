/**
 * AppDb — Thin async database abstraction layer for PostgreSQL.
 *
 * Service files use this interface via getDbForDomain().
 * The router (app-db-router.ts) returns the PostgreSQL adapter for all domains.
 *
 * SQL Convention:
 * - Use `?` placeholders in all queries.
 * - The PostgreSQL adapter converts `?` → `$1, $2, $3` internally.
 * - Use standard SQL where possible.
 */

export interface QueryResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface AppDb {
  /**
   * Execute a SELECT query and return all matching rows.
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Execute a SELECT query and return the first matching row, or null.
   */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Execute an INSERT/UPDATE/DELETE statement.
   */
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;

  /**
   * Run multiple operations in a transaction.
   * The callback receives a transactional AppDb instance.
   * If the callback throws, the transaction is rolled back.
   */
  transaction<T>(fn: (db: AppDb) => Promise<T>): Promise<T>;

  /**
   * Check database connectivity.
   */
  healthCheck(): Promise<boolean>;
}
