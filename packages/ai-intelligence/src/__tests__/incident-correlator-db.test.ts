/**
 * DB-backed integration test: verifies that correlateInsights writes the
 * `signature` column on every new incident row.
 *
 * Uses a real PostgreSQL test database (redirected via app-db-router mock).
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
 *   npx vitest run src/__tests__/incident-correlator-db.test.ts
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

// Redirect all DB calls to the test database
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

// Avoid live settings DB calls
vi.mock('@dashboard/core/services/settings-store.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    getEffectiveMonitoringConfig: vi.fn().mockResolvedValue({
      smartGroupingEnabled: false,
      smartGroupingSimilarityThreshold: 0.3,
      incidentSummaryEnabled: false,
    }),
  };
});

// Skip LLM summarisation
vi.mock('../services/incident-summarizer.js', () => ({
  generateLlmIncidentSummary: vi.fn().mockResolvedValue(null),
}));

// Skip Ollama availability check
vi.mock('../services/llm-client.js', () => ({
  isLlmAvailable: vi.fn().mockResolvedValue(false),
}));

import { correlateInsights } from '../services/incident-correlator.js';
import { insertInsights, type InsightInsert } from '../services/insights-store.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';

function makeInsight(overrides: Partial<Insight> & Pick<Insight, 'id' | 'container_id' | 'container_name' | 'category' | 'created_at'>): Insight {
  return {
    endpoint_id: 1,
    endpoint_name: 'eA',
    severity: 'warning',
    title: '',
    description: 'd',
    suggested_action: null,
    is_acknowledged: 0,
    metric_type: undefined,
    detection_method: undefined,
    ...overrides,
  } as Insight;
}

beforeAll(async () => { testDb = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => { await truncateTestTables(['incidents', 'insights']); });

describe('correlateInsights — writes signature', () => {
  it('writes signature derived from structured fields (metric_type + detection_method)', async () => {
    // Insert insight rows to satisfy the FK reference from incidents.root_cause_insight_id
    const insightInserts: InsightInsert[] = [
      {
        id: 'i1', endpoint_id: 1, endpoint_name: 'e', container_id: 'c1', container_name: 'cn1',
        severity: 'warning', category: 'anomaly',
        title: 'Anomalous cpu usage on "cn1"', description: 'd', suggested_action: null,
      },
      {
        id: 'i2', endpoint_id: 1, endpoint_name: 'e', container_id: 'c1', container_name: 'cn1',
        severity: 'warning', category: 'anomaly',
        title: 'Anomalous cpu usage on "cn1"', description: 'd', suggested_action: null,
      },
    ];
    await insertInsights(insightInserts);

    // Build full Insight objects with structured fields so deriveSignature takes
    // the structured path (category + metric_type + detection_method) rather than
    // falling through to the title regex. The DB doesn't store these optional
    // fields yet, so we construct them in memory rather than reading back from DB.
    const fullInsights: Insight[] = [
      {
        id: 'i1', endpoint_id: 1, endpoint_name: 'e', container_id: 'c1', container_name: 'cn1',
        severity: 'warning', category: 'anomaly',
        metric_type: 'cpu', detection_method: 'ml-anomaly',
        title: 'Anomalous cpu usage on "cn1"', description: 'd', suggested_action: null,
        is_acknowledged: 0, created_at: new Date().toISOString(),
      },
      {
        id: 'i2', endpoint_id: 1, endpoint_name: 'e', container_id: 'c1', container_name: 'cn1',
        severity: 'warning', category: 'anomaly',
        metric_type: 'cpu', detection_method: 'ml-anomaly',
        title: 'Anomalous cpu usage on "cn1"', description: 'd', suggested_action: null,
        is_acknowledged: 0, created_at: new Date().toISOString(),
      },
    ];

    await correlateInsights(fullInsights);

    const incidentRows = await testDb.query<{ signature: string }>(
      'SELECT signature FROM incidents',
    );
    expect(incidentRows).toHaveLength(1);
    expect(incidentRows[0].signature).toBe('anomaly:ml-anomaly:cpu');
  });

  it('falls back to title-derived signature when structured fields are absent', async () => {
    const insightInserts: InsightInsert[] = [
      {
        id: 'j1', endpoint_id: 2, endpoint_name: 'e2', container_id: 'c2', container_name: 'cn2',
        severity: 'warning', category: 'anomaly',
        title: 'Anomalous memory usage on "cn2"', description: 'd', suggested_action: null,
      },
      {
        id: 'j2', endpoint_id: 2, endpoint_name: 'e2', container_id: 'c2', container_name: 'cn2',
        severity: 'warning', category: 'anomaly',
        title: 'Anomalous memory usage on "cn2"', description: 'd', suggested_action: null,
      },
    ];
    await insertInsights(insightInserts);

    // No metric_type / detection_method — title regex path
    const fullInsights: Insight[] = [
      {
        id: 'j1', endpoint_id: 2, endpoint_name: 'e2', container_id: 'c2', container_name: 'cn2',
        severity: 'warning', category: 'anomaly',
        title: 'Anomalous memory usage on "cn2"', description: 'd', suggested_action: null,
        is_acknowledged: 0, created_at: new Date().toISOString(),
      },
      {
        id: 'j2', endpoint_id: 2, endpoint_name: 'e2', container_id: 'c2', container_name: 'cn2',
        severity: 'warning', category: 'anomaly',
        title: 'Anomalous memory usage on "cn2"', description: 'd', suggested_action: null,
        is_acknowledged: 0, created_at: new Date().toISOString(),
      },
    ];

    await correlateInsights(fullInsights);

    const incidentRows = await testDb.query<{ signature: string }>(
      'SELECT signature FROM incidents',
    );
    expect(incidentRows).toHaveLength(1);
    // Title regex: "Anomalous memory usage" → anomaly:threshold:memory
    expect(incidentRows[0].signature).toBe('anomaly:threshold:memory');
  });
});

describe('correlator — long-running anomaly joins existing incident regardless of age', () => {
  it('absorbs a new insight into an active incident older than the 5-minute correlation window', async () => {
    // Seed the original insight FIRST (FK: incidents.root_cause_insight_id → insights.id).
    await testDb.execute(`
      INSERT INTO insights (id, endpoint_id, endpoint_name, container_id, container_name,
                            severity, category, title, description, suggested_action,
                            metric_type, detection_method, is_acknowledged, created_at)
      VALUES ('seed-insight', 1, 'eA', 'c1', 'web-app', 'warning', 'anomaly',
              'Anomalous cpu usage on "c1" (ML-detected)', '...', NULL,
              'cpu', 'ml-anomaly', false, NOW() - INTERVAL '30 minutes')
    `);
    // Seed an active incident created 30 minutes ago for c1 + cpu ML signature.
    await testDb.execute(`
      INSERT INTO incidents (
        id, title, severity, status, related_insight_ids, affected_containers,
        endpoint_id, endpoint_name, correlation_type, correlation_confidence,
        insight_count, summary, signature, created_at, updated_at, root_cause_insight_id
      ) VALUES (
        'inc-old', 'Anomalous cpu usage on "c1" (ML-detected)', 'warning', 'active',
        '["seed-insight"]'::jsonb, '["c1"]'::jsonb,
        1, 'eA', 'temporal', 'medium', 1, NULL,
        'anomaly:ml-anomaly:cpu', NOW() - INTERVAL '30 minutes',
        NOW() - INTERVAL '30 minutes', 'seed-insight'
      )
    `);

    const newInsight: Insight = makeInsight({
      id: 'fresh',
      container_id: 'c1',
      container_name: 'web-app',
      category: 'anomaly',
      metric_type: 'cpu',
      detection_method: 'ml-anomaly',
      title: 'Anomalous cpu usage on "c1" (ML-detected)',
      created_at: new Date().toISOString(),
    });

    const result = await correlateInsights([newInsight]);
    expect(result.insightsGrouped).toBe(1);
    expect(result.insightsUngrouped).toBe(0);

    // The new insight is now part of the existing 30-minute-old incident.
    const updated = await testDb.queryOne<{ related_insight_ids: string[]; insight_count: number }>(
      'SELECT related_insight_ids, insight_count FROM incidents WHERE id = ?',
      ['inc-old'],
    );
    expect(updated?.related_insight_ids).toContain('fresh');
    // insight_count = related_insight_ids.length + 1 (root cause); seeded with
    // ["seed-insight"] + now "fresh" appended → 2 related + 1 root = 3.
    expect(updated?.insight_count).toBe(3);
  });

  it('does NOT join an active incident when the signature differs', async () => {
    // CPU incident already exists, new memory anomaly should NOT join it.
    // Seed insight FIRST (FK: incidents.root_cause_insight_id → insights.id).
    await testDb.execute(`
      INSERT INTO insights (id, endpoint_id, endpoint_name, container_id, container_name,
                            severity, category, title, description, suggested_action,
                            metric_type, detection_method, is_acknowledged, created_at)
      VALUES ('seed-cpu', 1, 'eA', 'c1', 'web-app', 'warning', 'anomaly',
              'Anomalous cpu usage on "c1" (ML-detected)', '...', NULL,
              'cpu', 'ml-anomaly', false, NOW() - INTERVAL '10 minutes')
    `);
    await testDb.execute(`
      INSERT INTO incidents (
        id, title, severity, status, related_insight_ids, affected_containers,
        endpoint_id, endpoint_name, correlation_type, correlation_confidence,
        insight_count, summary, signature, created_at, updated_at, root_cause_insight_id
      ) VALUES (
        'inc-cpu', 'cpu', 'warning', 'active',
        '["seed-cpu"]'::jsonb, '["c1"]'::jsonb, 1, 'eA',
        'temporal', 'medium', 1, NULL, 'anomaly:ml-anomaly:cpu',
        NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', 'seed-cpu'
      )
    `);

    const memoryAnomaly: Insight = makeInsight({
      id: 'fresh-mem',
      container_id: 'c1',
      container_name: 'web-app',
      category: 'anomaly',
      metric_type: 'memory',
      detection_method: 'ml-anomaly',
      title: 'Anomalous memory usage on "c1" (ML-detected)',
      created_at: new Date().toISOString(),
    });

    const result = await correlateInsights([memoryAnomaly]);
    // New memory anomaly is ungrouped (different signature than existing cpu incident).
    expect(result.insightsGrouped).toBe(0);
    expect(result.insightsUngrouped).toBe(1);
  });
});
