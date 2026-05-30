import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';

let testDb: Awaited<ReturnType<typeof getTestDb>>;

// Redirect all DB calls to the test database
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { backfillSignatures } from '../../scripts/backfill-incident-signatures.js';

beforeEach(async () => {
  testDb = await getTestDb();
  await truncateTestTables(['incidents', 'insights']);
});
afterAll(async () => { await closeTestDb(); });

describe('backfillSignatures', () => {
  it('populates NULL signatures using the root insight category/fields', async () => {
    const db = await getTestDb();
    await db.execute(`
      INSERT INTO insights (id, endpoint_id, endpoint_name, container_id, container_name,
                            severity, category, title, description, suggested_action,
                            metric_type, detection_method, is_acknowledged, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, ['ins1', 1, 'e', 'c', 'cn', 'warning', 'anomaly',
        'Anomalous cpu usage on "cn"', 'd', null,
        'cpu', 'ml-anomaly', false]);

    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?::jsonb, ?::jsonb, ?, ?, 'dedup', 'high', ?, ?,
              ?, NOW(), NOW())
    `, ['inc1', 'Anomalous cpu usage on "cn"', 'warning', 'ins1',
        '[]', '["cn"]', 1, 'e', 1, null, null]);

    const result = await backfillSignatures({ batchSize: 100, force: false });
    expect(result.updated).toBe(1);

    const after = await db.queryOne<{ signature: string }>(
      'SELECT signature FROM incidents WHERE id = ?', ['inc1'],
    );
    expect(after?.signature).toBe('anomaly:ml-anomaly:cpu');
  });

  it('is idempotent — running again does nothing for already-set rows', async () => {
    const db = await getTestDb();
    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, ?::jsonb, ?::jsonb, NULL, NULL,
              'temporal', 'medium', ?, NULL, ?, NOW(), NOW())
    `, ['inc1', 'High cpu usage on "cn"', 'warning', '[]', '[]', 1, null]);

    const r1 = await backfillSignatures({ batchSize: 100, force: false });
    expect(r1.updated).toBe(1);
    const r2 = await backfillSignatures({ batchSize: 100, force: false });
    expect(r2.updated).toBe(0);
  });

  it('handles missing root insight via title fallback', async () => {
    const db = await getTestDb();

    // Insert the insight first (FK constraint requires it), but with NULL
    // metric_type and detection_method to exercise the "insight exists but has
    // no structured fields" branch — same code path as the title fallback.
    await db.execute(`
      INSERT INTO insights (id, endpoint_id, endpoint_name, container_id, container_name,
                            severity, category, title, description, suggested_action,
                            metric_type, detection_method, is_acknowledged, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, ['ins-pred', 1, 'e', 'c', 'cn', 'warning', 'predictive',
        'Predicted memory exhaustion on "cn" ~24h', 'd', null,
        null, null, false]);

    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?::jsonb, ?::jsonb, ?, ?, 'dedup', 'high', ?, ?, ?, NOW(), NOW())
    `, ['inc1', 'Predicted memory exhaustion on "cn" ~24h', 'warning', 'ins-pred',
        '[]', '["cn"]', 1, 'e', 1, null, null]);

    const result = await backfillSignatures({ batchSize: 100, force: false });
    expect(result.updated).toBe(1);

    const after = await db.queryOne<{ signature: string }>(
      'SELECT signature FROM incidents WHERE id = ?', ['inc1'],
    );
    expect(after?.signature).toBe('predictive:prediction:memory');
  });

  it('force: true re-derives every row regardless of existing signature', async () => {
    const db = await getTestDb();
    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, ?::jsonb, ?::jsonb, NULL, NULL,
              'temporal', 'medium', ?, NULL, ?, NOW(), NOW())
    `, ['inc-force', 'High cpu usage on "test"', 'warning', '[]', '[]', 1, 'anomaly:threshold:cpu']);

    // Default mode is null-only — should skip the already-set row.
    const r1 = await backfillSignatures({ batchSize: 100, force: false });
    expect(r1.updated).toBe(0);

    // Force mode should re-derive regardless of existing signature.
    const r2 = await backfillSignatures({ batchSize: 100, force: true });
    expect(r2.updated).toBe(1);
    expect(r2.bySignature['anomaly:threshold:cpu']).toBe(1);
  });
});
