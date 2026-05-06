import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';

let testDb: Awaited<ReturnType<typeof getTestDb>>;

// Redirect all DB calls to the test database
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { getIncidents } from '../services/incident-store.js';

beforeEach(async () => {
  testDb = await getTestDb();
  await truncateTestTables(['incidents']);
});
afterAll(async () => { await closeTestDb(); });

describe('getIncidents — signature filter', () => {
  it('returns only matching signature when provided', async () => {
    const db = await getTestDb();
    const insertSQL = `
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, '[]'::jsonb, '[]'::jsonb, NULL, NULL,
              'temporal', 'medium', 1, NULL, ?, NOW(), NOW())
    `;
    await db.execute(insertSQL, ['a', 'A', 'warning', 'anomaly:ml-anomaly:cpu']);
    await db.execute(insertSQL, ['b', 'B', 'warning', 'anomaly:ml-anomaly:memory']);
    await db.execute(insertSQL, ['c', 'C', 'warning', 'predictive:prediction:memory']);

    const rows = await getIncidents({ signature: 'anomaly:ml-anomaly:memory' });
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('combines with status filter', async () => {
    const db = await getTestDb();
    const insertSQL = `
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, '[]'::jsonb, '[]'::jsonb, NULL, NULL,
              'temporal', 'medium', 1, NULL, ?, NOW(), NOW())
    `;
    await db.execute(insertSQL, ['a', 'A', 'warning', 'active', 'anomaly:ml-anomaly:cpu']);
    await db.execute(insertSQL, ['b', 'B', 'warning', 'resolved', 'anomaly:ml-anomaly:memory']);
    await db.execute(insertSQL, ['c', 'C', 'warning', 'active', 'predictive:prediction:memory']);

    const rows = await getIncidents({ status: 'active', signature: 'predictive:prediction:memory' });
    expect(rows.map((r) => r.id)).toEqual(['c']);
  });

  it('returns all when omitted', async () => {
    const db = await getTestDb();
    const insertSQL = `
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, '[]'::jsonb, '[]'::jsonb, NULL, NULL,
              'temporal', 'medium', 1, NULL, ?, NOW(), NOW())
    `;
    await db.execute(insertSQL, ['a', 'A', 'warning', 'anomaly:ml-anomaly:cpu']);
    await db.execute(insertSQL, ['b', 'B', 'warning', 'anomaly:ml-anomaly:memory']);
    await db.execute(insertSQL, ['c', 'C', 'warning', 'predictive:prediction:memory']);

    const rows = await getIncidents({});
    expect(rows).toHaveLength(3);
  });
});
