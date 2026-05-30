/**
 * Daily retention job for the `spans` table.
 *
 * Deletes in 10k-row batches so the DELETE never holds long locks. Caller is
 * the scheduler — runs alongside `cleanOldMetrics` in the existing cleanup
 * window.
 */
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const BATCH = 10_000;
const log = createChildLogger('trace-retention');

export async function cleanOldSpans(days: number): Promise<{ deleted: number }> {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('cleanOldSpans: days must be a positive integer');
  }
  const db = getDbForDomain('traces');
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // CAST via `make_interval` is cleaner than string concat — keeps the
    // parameter typed as int.
    const result = await db.execute(
      `DELETE FROM spans
       WHERE id IN (
         SELECT id FROM spans
         WHERE start_time < now() - make_interval(days => ?)
         LIMIT ${BATCH}
       )`,
      [days],
    );
    const deleted = result.changes ?? 0;
    total += deleted;
    if (deleted < BATCH) break;
  }
  if (total > 0) {
    log.info({ deleted: total, retentionDays: days }, 'spans cleanup');
  }
  return { deleted: total };
}
