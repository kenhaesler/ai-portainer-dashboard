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
