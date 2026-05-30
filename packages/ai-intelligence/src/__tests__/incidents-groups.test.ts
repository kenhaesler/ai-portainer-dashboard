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
    // insights must come before incidents (FK); CASCADE handles the reverse on teardown.
    await truncateTestTables('insights', 'incidents');
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

    // Insight that will be referenced as root_cause for one of the CPU incidents.
    // The description carries the metric values we want to surface in the UI.
    await db.execute(`
      INSERT INTO insights (id, endpoint_id, endpoint_name, container_id, container_name,
                            severity, category, title, description, suggested_action,
                            is_acknowledged, created_at, metric_type, detection_method)
      VALUES ('ins-a1', 1, 'eA', 'cid-c1', 'c1',
              'critical', 'anomaly',
              'Anomalous cpu usage on "c1" (ML-detected)',
              'CPU 94% on c1 — baseline 22%, ML high confidence', NULL,
              FALSE, NOW(), 'cpu', 'ml-anomaly')
    `);

    // Backfill incident a1 to point at that insight + carry a summary string.
    await db.execute(`
      UPDATE incidents
      SET root_cause_insight_id = 'ins-a1',
          summary = 'CPU spike on c1 — investigate'
      WHERE id = 'a1'
    `);

    // Second active CPU anomaly on the SAME container c1 — this is the duplicate
    // case the UI must collapse to a single row.
    await db.execute(ins, ['a1b', 'cpu', 'warning', '["c1"]', 1, 'eA', 1, 'anomaly:ml-anomaly:cpu']);
  });
  afterAll(async () => { await closeTestDb(); });

  it('aggregates by signature with counts', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    // a1b is a 5th active incident (a1, a1b, a2, a3 for cpu + m1)
    expect(result.total_active).toBe(5);

    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu');
    expect(cpu).toBeDefined();
    // a1b is the 4th cpu incident
    expect(cpu!.incident_count).toBe(4);
    expect(cpu!.container_count).toBe(3);
    // alert_count = sum of insight_count: a1(5) + a2(3) + a3(2) + a1b(1) = 11
    expect(cpu!.alert_count).toBe(5 + 3 + 2 + 1);
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
    // a1b is on eA (endpoint_id=1), so eA now has a1, a2, a1b = 3 incidents
    const eA = result.endpoint_facets.find((f) => f.endpoint_id === 1)!;
    expect(eA.incident_count).toBe(3);
    const eB = result.endpoint_facets.find((f) => f.endpoint_id === 2)!;
    expect(eB.incident_count).toBe(2);
  });

  it('endpoint_id filter narrows the result', async () => {
    const result = await getIncidentGroups({ status: 'active', endpoint_id: 2 });
    expect(result.total_active).toBe(2);
  });

  it('since_minutes filter applies against updated_at', async () => {
    // updated_at is NOW(); all rows match a 1-hour window (now 5 active: a1, a2, a3, m1, a1b)
    const result = await getIncidentGroups({ status: 'active', since_minutes: 60 });
    expect(result.total_active).toBe(5);
  });

  it('excludes resolved incidents when status=active', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const incidentIds = result.groups.flatMap((g) => g.top_containers.map((tc) => tc.incident_id));
    expect(incidentIds).not.toContain('r1');
  });

  it('dedupes top_containers to one row per (signature, container)', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    const names = cpu.top_containers.map((tc) => tc.container_name);
    // c1 appears in incidents a1 and a1b; expect a single row.
    expect(names).toEqual(Array.from(new Set(names)));
    const c1Row = cpu.top_containers.find((tc) => tc.container_name === 'c1')!;
    expect(c1Row.incident_count).toBe(2);
    expect(c1Row.incident_ids.sort()).toEqual(['a1', 'a1b']);
    // Representative must be the highest-severity incident (a1 = critical).
    expect(c1Row.severity).toBe('critical');
    expect(c1Row.incident_id).toBe('a1');
  });

  it('container_count is unchanged by dedupe (still distinct containers)', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    // c1, c2, c3 — three distinct containers despite four CPU incidents (a1, a1b, a2, a3).
    expect(cpu.container_count).toBe(3);
    expect(cpu.incident_count).toBe(4);
  });

  it('surfaces latest_description from the root-cause insight and latest_summary from the incident', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    const c1Row = cpu.top_containers.find((tc) => tc.container_name === 'c1')!;
    expect(c1Row.latest_description).toBe('CPU 94% on c1 — baseline 22%, ML high confidence');
    expect(c1Row.latest_summary).toBe('CPU spike on c1 — investigate');
    // c2 had no insight wired up; description should be null and not crash.
    const c2Row = cpu.top_containers.find((tc) => tc.container_name === 'c2')!;
    expect(c2Row.latest_description).toBeNull();
  });
});
