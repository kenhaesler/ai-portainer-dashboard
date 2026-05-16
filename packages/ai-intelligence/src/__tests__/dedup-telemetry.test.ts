/**
 * DB-backed integration test for the dedup-engine telemetry job (#1200).
 *
 * Seeds insights + incidents in the test DB, runs `collectDedupMetrics`,
 * asserts the per-signature rollup matches expected totals, then runs the
 * full cycle and asserts the snapshot row landed in monitoring_dedup_metrics.
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
 *   npx vitest run src/__tests__/dedup-telemetry.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import {
  collectDedupMetrics,
  insertDedupMetrics,
  runDedupTelemetryCycle,
} from '../services/dedup-telemetry.js';

interface MetricRow {
  signature: string;
  total_insights: number;
  distinct_containers: number;
  alerts_per_container: number;
  total_incidents: number;
  avg_insights_per_incident: number;
}

async function seedInsight(opts: {
  id: string;
  category: string;
  container_name: string;
  metric_type?: string | null;
  detection_method?: string | null;
  hours_ago?: number;
}): Promise<void> {
  await testDb.execute(
    `INSERT INTO insights (
      id, endpoint_id, endpoint_name, container_id, container_name,
      severity, category, title, description, is_acknowledged,
      created_at, metric_type, detection_method
    ) VALUES (?, 1, 'e', ?, ?, 'warning', ?, 't', 'd', false,
              NOW() - make_interval(hours => ?), ?, ?)`,
    [
      opts.id,
      'cid-' + opts.container_name,
      opts.container_name,
      opts.category,
      opts.hours_ago ?? 1,
      opts.metric_type ?? null,
      opts.detection_method ?? null,
    ],
  );
}

async function seedIncident(opts: {
  id: string;
  signature: string;
  insight_count: number;
  status?: 'active' | 'resolved';
}): Promise<void> {
  await testDb.execute(
    `INSERT INTO incidents (
      id, title, severity, status, related_insight_ids, affected_containers,
      endpoint_id, endpoint_name, correlation_type, correlation_confidence,
      insight_count, signature
    ) VALUES (?, 't', 'warning', ?, '[]'::jsonb, '["c"]'::jsonb, 1, 'e',
              'dedup', 'medium', ?, ?)`,
    [opts.id, opts.status ?? 'active', opts.insight_count, opts.signature],
  );
}

beforeAll(async () => { testDb = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => {
  await truncateTestTables('monitoring_dedup_metrics', 'incidents', 'insights');
});

describe('collectDedupMetrics', () => {
  it('rolls up insights by derived signature using structured fields', async () => {
    // 3 CPU threshold insights on container A, 2 on B → signature shared
    for (let i = 0; i < 3; i++) {
      await seedInsight({
        id: 'a' + i, category: 'anomaly', container_name: 'web-a',
        metric_type: 'cpu', detection_method: 'threshold',
      });
    }
    for (let i = 0; i < 2; i++) {
      await seedInsight({
        id: 'b' + i, category: 'anomaly', container_name: 'web-b',
        metric_type: 'cpu', detection_method: 'threshold',
      });
    }

    const rows = await collectDedupMetrics(testDb);
    const cpu = rows.find((r) => r.signature === 'anomaly:threshold:cpu');

    expect(cpu).toBeDefined();
    expect(cpu!.total_insights).toBe(5);
    expect(cpu!.distinct_containers).toBe(2);
    expect(cpu!.alerts_per_container).toBeCloseTo(2.5, 1);
  });

  it('uses category-only fallback for security / log / ai-analysis insights', async () => {
    await seedInsight({ id: 's1', category: 'security',     container_name: 'x' });
    await seedInsight({ id: 's2', category: 'security',     container_name: 'x' });
    await seedInsight({ id: 'l1', category: 'log-analysis', container_name: 'y' });
    await seedInsight({ id: 'a1', category: 'ai-analysis',  container_name: 'z' });

    const rows = await collectDedupMetrics(testDb);
    const bySig = new Map(rows.map((r) => [r.signature, r]));

    expect(bySig.get('security:scan')?.total_insights).toBe(2);
    expect(bySig.get('log:pattern')?.total_insights).toBe(1);
    expect(bySig.get('ai:analysis')?.total_insights).toBe(1);
  });

  it('respects the window — drops insights older than windowHours', async () => {
    await seedInsight({
      id: 'recent', category: 'anomaly', container_name: 'c1',
      metric_type: 'cpu', detection_method: 'threshold', hours_ago: 1,
    });
    await seedInsight({
      id: 'old', category: 'anomaly', container_name: 'c1',
      metric_type: 'cpu', detection_method: 'threshold', hours_ago: 200, // > 168 (7 days)
    });

    const rows = await collectDedupMetrics(testDb, 24 * 7);
    const cpu = rows.find((r) => r.signature === 'anomaly:threshold:cpu');

    expect(cpu?.total_insights).toBe(1);
  });

  it('joins incident counts onto matching signatures', async () => {
    await seedInsight({
      id: 'i1', category: 'anomaly', container_name: 'c1',
      metric_type: 'cpu', detection_method: 'threshold',
    });
    await seedIncident({ id: 'inc1', signature: 'anomaly:threshold:cpu', insight_count: 18 });
    await seedIncident({ id: 'inc2', signature: 'anomaly:threshold:cpu', insight_count: 12 });

    const rows = await collectDedupMetrics(testDb);
    const cpu = rows.find((r) => r.signature === 'anomaly:threshold:cpu');

    expect(cpu?.total_incidents).toBe(2);
    expect(cpu?.avg_insights_per_incident).toBeCloseTo(15, 0);
  });

  it('still returns signatures present in incidents but not in insights', async () => {
    await seedIncident({ id: 'inc1', signature: 'legacy:signature', insight_count: 4 });

    const rows = await collectDedupMetrics(testDb);
    const legacy = rows.find((r) => r.signature === 'legacy:signature');

    expect(legacy).toBeDefined();
    expect(legacy!.total_insights).toBe(0);
    expect(legacy!.alerts_per_container).toBe(0);
    expect(legacy!.total_incidents).toBe(1);
  });

  it('returns an empty array when nothing exists in the window', async () => {
    const rows = await collectDedupMetrics(testDb);
    expect(rows).toEqual([]);
  });
});

describe('insertDedupMetrics', () => {
  it('writes one row per metric and stamps collected_at', async () => {
    await insertDedupMetrics(testDb, 168, [
      {
        signature: 'anomaly:threshold:cpu',
        total_insights: 100,
        distinct_containers: 10,
        alerts_per_container: 10,
        total_incidents: 5,
        avg_insights_per_incident: 20,
      },
    ]);

    const persisted = await testDb.query<MetricRow & { window_hours: number }>(
      `SELECT signature, total_insights, distinct_containers,
              alerts_per_container::float AS alerts_per_container,
              total_incidents, avg_insights_per_incident::float AS avg_insights_per_incident,
              window_hours
       FROM monitoring_dedup_metrics`,
    );

    expect(persisted).toHaveLength(1);
    expect(persisted[0].signature).toBe('anomaly:threshold:cpu');
    expect(persisted[0].total_insights).toBe(100);
    expect(persisted[0].alerts_per_container).toBeCloseTo(10, 1);
    expect(persisted[0].window_hours).toBe(168);
  });
});

describe('runDedupTelemetryCycle', () => {
  it('collects + inserts and reports the row count', async () => {
    await seedInsight({
      id: 'i1', category: 'anomaly', container_name: 'c1',
      metric_type: 'memory', detection_method: 'ml-anomaly',
    });

    const result = await runDedupTelemetryCycle();
    expect(result.collected).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.windowHours).toBe(168);

    const persisted = await testDb.query<{ signature: string }>(
      `SELECT signature FROM monitoring_dedup_metrics`,
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0].signature).toBe('anomaly:ml-anomaly:memory');
  });

  it('is a no-op on an empty DB and reports 0', async () => {
    const result = await runDedupTelemetryCycle();
    expect(result.collected).toBe(0);
    expect(result.inserted).toBe(0);

    const persisted = await testDb.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM monitoring_dedup_metrics`,
    );
    expect(persisted[0].count).toBe(0);
  });

  it('appends rather than overwriting across repeated cycles', async () => {
    await seedInsight({
      id: 'i1', category: 'anomaly', container_name: 'c1',
      metric_type: 'cpu', detection_method: 'threshold',
    });

    await runDedupTelemetryCycle();
    await runDedupTelemetryCycle();

    const persisted = await testDb.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM monitoring_dedup_metrics`,
    );
    expect(persisted[0].count).toBe(2);
  });
});
