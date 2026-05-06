import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';

let testDb: Awaited<ReturnType<typeof getTestDb>>;

// Redirect all DB calls to the test database
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { getIncidentGroups } from '../services/incident-store.js';

describe('getIncidentGroups', () => {
  beforeEach(async () => {
    testDb = await getTestDb();
    await truncateTestTables('incidents');
    const db = await getTestDb();
    const ins = `
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, '[]'::jsonb, ?::jsonb, ?, ?, 'temporal', 'medium', ?, NULL, ?, NOW(), NOW())
    `;
    // 3 active CPU anomalies on 3 containers, 1 critical 2 warning, 2 endpoints
    await db.execute(ins, ['a1', 'cpu', 'critical', '["c1"]', 1, 'eA', 5, 'anomaly:ml-anomaly:cpu']);
    await db.execute(ins, ['a2', 'cpu', 'warning',  '["c2"]', 1, 'eA', 3, 'anomaly:ml-anomaly:cpu']);
    await db.execute(ins, ['a3', 'cpu', 'warning',  '["c3"]', 2, 'eB', 2, 'anomaly:ml-anomaly:cpu']);
    // 1 active memory prediction
    await db.execute(ins, ['m1', 'mem', 'warning',  '["c4"]', 2, 'eB', 1, 'predictive:prediction:memory']);
    // 1 resolved (must not appear when status=active)
    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, signature, related_insight_ids,
                             affected_containers, correlation_type, correlation_confidence,
                             insight_count, created_at, updated_at, resolved_at)
      VALUES ('r1', 'r', 'warning', 'resolved', 'anomaly:ml-anomaly:cpu', '[]'::jsonb,
              '[]'::jsonb, 'temporal', 'medium', 1, NOW(), NOW(), NOW())
    `);
  });
  afterAll(async () => { await closeTestDb(); });

  it('aggregates by signature with counts', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    expect(result.total_active).toBe(4);

    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu');
    expect(cpu).toBeDefined();
    expect(cpu!.incident_count).toBe(3);
    expect(cpu!.container_count).toBe(3);
    expect(cpu!.alert_count).toBe(5 + 3 + 2); // sum of insight_count across group
    expect(cpu!.severity).toBe('critical');  // highest in group
  });

  it('returns top_containers ordered by severity then recency, capped at 10', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    expect(cpu.top_containers.length).toBeLessThanOrEqual(10);
    expect(cpu.top_containers[0].severity).toBe('critical');
  });

  it('includes all_container_names with names_truncated flag', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    expect(cpu.all_container_names.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(cpu.names_truncated).toBe(false);
  });

  it('endpoint_facets reflects distribution', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const eA = result.endpoint_facets.find((f) => f.endpoint_id === 1)!;
    expect(eA.incident_count).toBe(2);
    const eB = result.endpoint_facets.find((f) => f.endpoint_id === 2)!;
    expect(eB.incident_count).toBe(2);
  });

  it('endpoint_id filter narrows the result', async () => {
    const result = await getIncidentGroups({ status: 'active', endpoint_id: 2 });
    expect(result.total_active).toBe(2);
  });

  it('since_minutes filter applies against updated_at', async () => {
    // updated_at is NOW(); all rows match a 1-hour window
    const result = await getIncidentGroups({ status: 'active', since_minutes: 60 });
    expect(result.total_active).toBe(4);
  });

  it('excludes resolved incidents when status=active', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const incidentIds = result.groups.flatMap((g) => g.top_containers.map((tc) => tc.incident_id));
    expect(incidentIds).not.toContain('r1');
  });
});
