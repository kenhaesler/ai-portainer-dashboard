/**
 * Generic batched retention delete for app-DB history tables (#1505).
 *
 * Deletes rows older than `days` in fixed-size batches (mirrors the spans
 * retention job in @dashboard/observability) so a first sweep over a
 * long-lived deployment never holds long locks. Every covered table has an
 * `id` primary key and an indexed timestamp column, so both the sub-select
 * and the delete stay cheap.
 */
import type { AppDb } from './app-db.js';

const DEFAULT_BATCH = 10_000;

// Identifiers are developer-supplied constants, never user input — the
// pattern check is a belt-and-braces guard against accidental injection.
const IDENTIFIER_PATTERN = /^[a-z_]+$/;

export async function batchedDeleteOlderThan(
  db: AppDb,
  table: string,
  timestampColumn: string,
  days: number,
  batchSize: number = DEFAULT_BATCH,
): Promise<number> {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`batchedDeleteOlderThan: days must be a positive integer (got ${days})`);
  }
  if (!IDENTIFIER_PATTERN.test(table) || !IDENTIFIER_PATTERN.test(timestampColumn)) {
    throw new Error(`batchedDeleteOlderThan: invalid identifier ${table}.${timestampColumn}`);
  }

  let total = 0;
  for (;;) {
    const result = await db.execute(
      `DELETE FROM ${table}
       WHERE id IN (
         SELECT id FROM ${table}
         WHERE ${timestampColumn} < NOW() - make_interval(days => ?)
         LIMIT ${batchSize}
       )`,
      [days],
    );
    const deleted = result.changes ?? 0;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}
