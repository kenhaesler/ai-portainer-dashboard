import { beforeAll, afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import { correlateInsights } from '../services/incident-correlator.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';
import { insertIncident, addInsightToIncident, getActiveIncidentForContainer } from '../services/incident-store.js';

// Kept: DB-backed store mock — incident-store writes to PostgreSQL
vi.mock('../services/incident-store.js', () => ({
  insertIncident: vi.fn(() => Promise.resolve()),
  addInsightToIncident: vi.fn(() => Promise.resolve()),
  getActiveIncidentForContainer: vi.fn(() => Promise.resolve(undefined)),
}));

// Kept: internal service mock — alert similarity computation
vi.mock('../../observability/services/alert-similarity.js', () => ({
  findSimilarInsights: vi.fn(() => []),
}));

// Kept: internal service mock — incident summarizer (tests correlation, not summarization)
vi.mock('../services/incident-summarizer.js', () => ({
  generateLlmIncidentSummary: vi.fn(() => Promise.resolve(null)),
}));

const mockedInsertIncident = vi.mocked(insertIncident);
const mockedAddInsightToIncident = vi.mocked(addInsightToIncident);
const mockedGetActiveIncidentForContainer = vi.mocked(getActiveIncidentForContainer);

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: `insight-${Math.random().toString(36).slice(2, 8)}`,
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'container-abc',
    container_name: 'web-app',
    severity: 'warning',
    category: 'anomaly',
    title: 'Anomalous CPU usage on "web-app"',
    description: 'Current CPU: 95% (z-score: 3.5)',
    suggested_action: 'Check for runaway processes',
    is_acknowledged: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}


beforeAll(() => {
    setConfigForTest({
      SMART_GROUPING_ENABLED: false,
      SMART_GROUPING_SIMILARITY_THRESHOLD: 0.3,
      INCIDENT_SUMMARY_ENABLED: false,
    });
});

afterAll(() => {
  resetConfig();
});

describe('incident-correlator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('correlateInsights', () => {
    it('should return zeros for empty input', async () => {
      const result = await correlateInsights([]);
      expect(result.incidentsCreated).toBe(0);
      expect(result.insightsGrouped).toBe(0);
      expect(result.insightsUngrouped).toBe(0);
    });

    it('should not correlate non-anomaly insights', async () => {
      const insights = [
        makeInsight({ category: 'security:root-user' }),
        makeInsight({ category: 'ai-analysis' }),
      ];
      const result = await correlateInsights(insights);
      expect(result.incidentsCreated).toBe(0);
      expect(result.insightsUngrouped).toBe(2);
    });

    it('should not create incident for single anomaly', async () => {
      const insights = [makeInsight()];
      const result = await correlateInsights(insights);
      expect(result.incidentsCreated).toBe(0);
      expect(result.insightsUngrouped).toBe(1);
    });

    it('should create dedup incident for same container anomalies', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'db', title: 'CPU anomaly' }),
        makeInsight({ container_id: 'c1', container_name: 'db', title: 'Memory anomaly' }),
      ];

      const result = await correlateInsights(insights);
      expect(result.incidentsCreated).toBe(1);
      expect(result.insightsGrouped).toBe(2);
      expect(mockedInsertIncident).toHaveBeenCalledTimes(1);

      const call = mockedInsertIncident.mock.calls[0][0];
      expect(call.correlation_type).toBe('dedup');
      expect(call.insight_count).toBe(2);
      expect(call.affected_containers).toContain('db');
    });

    it('should create cascade incident for multiple containers with distinct metric types', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'web', endpoint_id: 1, title: 'Anomalous cpu usage on "web"' }),
        makeInsight({ container_id: 'c2', container_name: 'api', endpoint_id: 1, title: 'Anomalous memory usage on "api"' }),
        makeInsight({ container_id: 'c3', container_name: 'db', endpoint_id: 1, title: 'Anomalous cpu usage on "db"' }),
      ];

      const result = await correlateInsights(insights);
      expect(result.incidentsCreated).toBe(1);
      expect(result.insightsGrouped).toBe(3);
      expect(mockedInsertIncident).toHaveBeenCalledTimes(1);

      const call = mockedInsertIncident.mock.calls[0][0];
      expect(call.correlation_type).toBe('cascade');
      expect(call.insight_count).toBe(3);
    });

    it('should NOT create cascade when all containers have same metric type', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'web', endpoint_id: 1, title: 'Anomalous cpu usage on "web"' }),
        makeInsight({ container_id: 'c2', container_name: 'api', endpoint_id: 1, title: 'Anomalous cpu usage on "api"' }),
        makeInsight({ container_id: 'c3', container_name: 'db', endpoint_id: 1, title: 'Anomalous cpu usage on "db"' }),
      ];

      const result = await correlateInsights(insights);
      expect(result.incidentsCreated).toBe(0);
      expect(result.insightsUngrouped).toBe(3);
    });

    it('should use highest severity from group', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', severity: 'warning', endpoint_id: 1, title: 'Anomalous cpu usage on "a"' }),
        makeInsight({ container_id: 'c2', severity: 'critical', endpoint_id: 1, title: 'Anomalous memory usage on "b"' }),
      ];

      await correlateInsights(insights);
      const call = mockedInsertIncident.mock.calls[0][0];
      expect(call.severity).toBe('critical');
    });

    it('should set high confidence for cascade with 3+ insights', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'a', endpoint_id: 1, title: 'Anomalous cpu usage on "a"' }),
        makeInsight({ container_id: 'c2', container_name: 'b', endpoint_id: 1, title: 'Anomalous memory usage on "b"' }),
        makeInsight({ container_id: 'c3', container_name: 'c', endpoint_id: 1, title: 'Anomalous network_rx usage on "c"' }),
      ];

      await correlateInsights(insights);
      const call = mockedInsertIncident.mock.calls[0][0];
      expect(call.correlation_confidence).toBe('high');
    });

    it('should set high confidence for dedup correlations', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'db' }),
        makeInsight({ container_id: 'c1', container_name: 'db' }),
      ];

      await correlateInsights(insights);
      const call = mockedInsertIncident.mock.calls[0][0];
      expect(call.correlation_confidence).toBe('high');
    });

    it('should separate insights by endpoint', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'web', endpoint_id: 1 }),
        makeInsight({ container_id: 'c2', container_name: 'api', endpoint_id: 2 }),
      ];

      const result = await correlateInsights(insights);
      expect(result.incidentsCreated).toBe(0);
      expect(result.insightsUngrouped).toBe(2);
    });

    it('should handle mixed anomaly and non-anomaly insights', async () => {
      const insights = [
        makeInsight({ category: 'anomaly', container_id: 'c1' }),
        makeInsight({ category: 'security:root-user', container_id: 'c2' }),
      ];

      const result = await correlateInsights(insights);
      expect(result.incidentsCreated).toBe(0);
      expect(result.insightsUngrouped).toBe(2);
    });

    it('should generate meaningful titles for cascade incidents', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'web', endpoint_id: 1, endpoint_name: 'production', title: 'Anomalous cpu usage on "web"' }),
        makeInsight({ container_id: 'c2', container_name: 'api', endpoint_id: 1, endpoint_name: 'production', title: 'Anomalous memory usage on "api"' }),
      ];

      await correlateInsights(insights);
      const call = mockedInsertIncident.mock.calls[0][0];
      expect(call.title).toContain('web');
      expect(call.title).toContain('api');
    });

    it('should generate summary for incidents', async () => {
      const insights = [
        makeInsight({ container_id: 'c1', container_name: 'db', severity: 'critical' }),
        makeInsight({ container_id: 'c1', container_name: 'db', severity: 'warning' }),
      ];

      await correlateInsights(insights);
      const call = mockedInsertIncident.mock.calls[0][0];
      expect(call.summary).toBeTruthy();
      expect(call.summary).toContain('2');
    });

    it('should add insight to existing incident when match found', async () => {
      mockedGetActiveIncidentForContainer.mockResolvedValueOnce({
        id: 'existing-incident',
        title: 'Existing',
        severity: 'warning',
        status: 'active',
        root_cause_insight_id: 'root-1',
        related_insight_ids: [],
        affected_containers: ['web'],
        endpoint_id: 1,
        endpoint_name: 'local',
        correlation_type: 'cascade',
        correlation_confidence: 'medium',
        insight_count: 2,
        summary: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolved_at: null,
      });

      const insights = [makeInsight({ container_id: 'c1', container_name: 'web' })];
      const result = await correlateInsights(insights);

      expect(result.insightsGrouped).toBe(1);
      expect(mockedAddInsightToIncident).toHaveBeenCalledTimes(1);
    });
  });
});
