import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '../../../core/db/test-db-helper.js';
import type { AppDb } from '../../../core/db/app-db.js';
import { prometheusRoutes, resetPrometheusMetricsCacheForTests } from '../routes/prometheus.js';
import { setConfigForTest, resetConfig } from '../../../core/config/index.js';

let appDb: AppDb;

// Kept: app-db-router mock — tests control database routing
vi.mock('../../../core/db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));

// Kept: prompt-guard mock — side-effect isolation
vi.mock('../../../services/prompt-guard.js', () => ({
  getPromptGuardNearMissTotal: () => 0,
}));

describe('Prometheus Routes', () => {
  let app: FastifyInstance;
  let pool: Awaited<ReturnType<typeof getTestPool>>;

  beforeAll(async () => {
    appDb = await getTestDb();
    pool = await getTestPool();

    app = Fastify({ logger: false });
    await app.register(prometheusRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('insights', 'actions', 'monitoring_snapshots', 'monitoring_cycles');
    setConfigForTest({ PROMETHEUS_METRICS_ENABLED: false, PROMETHEUS_BEARER_TOKEN: undefined });
    resetPrometheusMetricsCacheForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetConfig();
  });

  it('returns 404 when metrics endpoint is disabled', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(404);
  });

  it('returns prometheus exposition text with dashboard metrics', async () => {
    setConfigForTest({ PROMETHEUS_METRICS_ENABLED: true });

    await pool.query(`
      INSERT INTO insights (id, severity, category, title, description, container_name, is_acknowledged)
      VALUES
        ('i1', 'critical', 'anomaly', 'Anomalous cpu usage on "api"', 'CPU anomaly detected', 'api', false),
        ('i2', 'warning', 'security:image', 'High-risk image', 'Image vulnerability found', 'api', true),
        ('i3', 'info', 'ai-analysis', 'AI summary', 'AI analysis complete', NULL, false)
    `);

    await pool.query(`
      INSERT INTO actions (id, endpoint_id, container_id, container_name, action_type, rationale, status, execution_duration_ms)
      VALUES
        ('a1', 1, 'c1', 'api', 'restart', 'High CPU', 'pending', NULL),
        ('a2', 1, 'c2', 'db', 'restart', 'OOM', 'completed', 2400),
        ('a3', 1, 'c3', 'web', 'stop', 'Crash loop', 'failed', 5000)
    `);

    await pool.query(`
      INSERT INTO monitoring_snapshots (
        containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down
      ) VALUES (8, 3, 1, 2, 1)
    `);

    await pool.query(`INSERT INTO monitoring_cycles (duration_ms) VALUES (1800), (950)`);

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain; version=0.0.4; charset=utf-8');

    expect(response.body).toContain('# TYPE dashboard_insights_total counter');
    expect(response.body).toContain('dashboard_insights_total{severity="critical",category="anomaly"} 1');
    expect(response.body).toContain('dashboard_insights_total{severity="warning",category="security"} 1');
    expect(response.body).toContain('dashboard_anomalies_detected_total{container_name="api",metric_type="cpu"} 1');
    expect(response.body).toContain('dashboard_remediation_actions_total{status="pending"} 1');
    expect(response.body).toContain('dashboard_containers_total{state="running"} 8');
    expect(response.body).toContain('dashboard_endpoints_total{status="down"} 1');
    expect(response.body).toContain('dashboard_active_anomalies 1');
    expect(response.body).toContain('# TYPE dashboard_remediation_duration_seconds histogram');
    expect(response.body).toContain('# TYPE dashboard_monitoring_cycle_duration_seconds histogram');
    expect(response.body).toContain('# TYPE process_resident_memory_bytes gauge');
    expect(response.body).toContain('# HELP prompt_guard_near_miss_total Prompt injection near-miss detections');
    expect(response.body).toContain('# TYPE prompt_guard_near_miss_total counter');
    expect(response.body).toContain('prompt_guard_near_miss_total 0');
  });

  it('enforces bearer token only when configured', async () => {
    setConfigForTest({
      PROMETHEUS_METRICS_ENABLED: true,
      PROMETHEUS_BEARER_TOKEN: 'metrics-token',
    });

    let response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(401);

    response = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(response.statusCode).toBe(401);

    response = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer metrics-token' },
    });
    expect(response.statusCode).toBe(200);
  });

  describe('production auth enforcement', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('returns 500 config error in production when no token is set', async () => {
      setConfigForTest({
        PROMETHEUS_METRICS_ENABLED: true,
        PROMETHEUS_BEARER_TOKEN: undefined,
      });
      process.env.NODE_ENV = 'production';

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain('PROMETHEUS_BEARER_TOKEN');
    });

    it('returns 500 config error in production when token is too short', async () => {
      setConfigForTest({
        PROMETHEUS_METRICS_ENABLED: true,
        PROMETHEUS_BEARER_TOKEN: 'short',
      });
      process.env.NODE_ENV = 'production';

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain('min 16 chars');
    });

    it('serves metrics in production when valid token is provided', async () => {
      setConfigForTest({
        PROMETHEUS_METRICS_ENABLED: true,
        PROMETHEUS_BEARER_TOKEN: 'a-valid-token-that-is-long-enough',
      });
      process.env.NODE_ENV = 'production';

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer a-valid-token-that-is-long-enough' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
    });

    it('serves metrics in development without a token', async () => {
      setConfigForTest({
        PROMETHEUS_METRICS_ENABLED: true,
        PROMETHEUS_BEARER_TOKEN: undefined,
      });
      process.env.NODE_ENV = 'development';

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
    });

    it('serves metrics in development with a valid token', async () => {
      setConfigForTest({
        PROMETHEUS_METRICS_ENABLED: true,
        PROMETHEUS_BEARER_TOKEN: 'dev-token-1234567890',
      });
      process.env.NODE_ENV = 'development';

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer dev-token-1234567890' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
    });
  });

  it('caches DB aggregations for 15 seconds', async () => {
    setConfigForTest({ PROMETHEUS_METRICS_ENABLED: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

    await pool.query(`
      INSERT INTO insights (id, severity, category, title, description, container_name, is_acknowledged)
      VALUES ('i1', 'critical', 'anomaly', 'Anomalous cpu usage on "api"', 'CPU anomaly detected', 'api', false)
    `);

    let response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toContain('dashboard_insights_total{severity="critical",category="anomaly"} 1');

    await pool.query(`
      INSERT INTO insights (id, severity, category, title, description, container_name, is_acknowledged)
      VALUES ('i2', 'critical', 'anomaly', 'Anomalous cpu usage on "api"', 'CPU anomaly detected', 'api', false)
    `);

    response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toContain('dashboard_insights_total{severity="critical",category="anomaly"} 1');

    vi.advanceTimersByTime(16_000);

    response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toContain('dashboard_insights_total{severity="critical",category="anomaly"} 2');
  });
});
