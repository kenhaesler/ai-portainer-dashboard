import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { cleanOldSpans } from './trace-retention.js';

let appDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));

let spanCounter = 0;
async function insertSpanAt(startTime: Date) {
  spanCounter += 1;
  await appDb.execute(
    `INSERT INTO spans (
       id, trace_id, parent_span_id, name, kind, status,
       start_time, end_time, duration_ms, service_name, attributes, created_at
     ) VALUES (?, ?, NULL, 'op', 'server', 'ok', ?, ?, 1, 's', '{}', NOW())`,
    [`rt-${spanCounter}`, `t-${spanCounter}`, startTime.toISOString(), startTime.toISOString()],
  );
}

beforeAll(async () => {
  appDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('spans');
  spanCounter = 0;
});

describe('cleanOldSpans', () => {
  it('deletes spans older than retention window, keeps recent', async () => {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recent = new Date();
    await insertSpanAt(old);
    await insertSpanAt(recent);
    const result = await cleanOldSpans(7);
    expect(result.deleted).toBe(1);
    const pool = await getTestPool();
    const { rows } = await pool.query<{ c: string }>('SELECT count(*)::text as c FROM spans');
    expect(Number(rows[0].c)).toBe(1);
  });

  it('returns 0 on empty table', async () => {
    expect((await cleanOldSpans(7)).deleted).toBe(0);
  });

  it('rejects non-positive days', async () => {
    await expect(cleanOldSpans(0)).rejects.toThrow();
    await expect(cleanOldSpans(-1)).rejects.toThrow();
  });
});
