import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { FastifyInstance } from 'fastify';
import { prometheusRoutes, resetPrometheusMetricsCacheForTests } from './prometheus.js';

const db = new Database(':memory:');
const mockConfig = {
  PROMETHEUS_METRICS_ENABLED: false,
  PROMETHEUS_BEARER_TOKEN: undefined as string | undefined,
};

vi.mock('../db/sqlite.js', () => ({
  getDb: () => db,
}));

vi.mock('../config/index.js', () => ({
  getConfig: () => mockConfig,
}));

describe('Prometheus Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    db.exec(`
      CREATE TABLE insights (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        container_name TEXT,
        is_acknowledged INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE actions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        execution_duration_ms INTEGER
      );
      CREATE TABLE monitoring_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        containers_running INTEGER NOT NULL,
        containers_stopped INTEGER NOT NULL,
        containers_unhealthy INTEGER NOT NULL,
        endpoints_up INTEGER NOT NULL,
        endpoints_down INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE monitoring_cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        duration_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    app = Fastify({ logger: false });
    await app.register(prometheusRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  beforeEach(() => {
    db.exec(`
      DELETE FROM insights;
      DELETE FROM actions;
      DELETE FROM monitoring_snapshots;
      DELETE FROM monitoring_cycles;
    `);
    mockConfig.PROMETHEUS_METRICS_ENABLED = false;
    mockConfig.PROMETHEUS_BEARER_TOKEN = undefined;
    resetPrometheusMetricsCacheForTests();
    vi.useRealTimers();
  });

  it('returns 404 when metrics endpoint is disabled', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(404);
  });

  it('returns prometheus exposition text with dashboard metrics', async () => {
    mockConfig.PROMETHEUS_METRICS_ENABLED = true;

    db.exec(`
      INSERT INTO insights (id, severity, category, title, container_name, is_acknowledged)
      VALUES
        ('i1', 'critical', 'anomaly', 'Anomalous cpu usage on "api"', 'api', 0),
        ('i2', 'warning', 'security:image', 'High-risk image', 'api', 1),
        ('i3', 'info', 'ai-analysis', 'AI summary', NULL, 0);

      INSERT INTO actions (id, status, execution_duration_ms)
      VALUES
        ('a1', 'pending', NULL),
        ('a2', 'completed', 2400),
        ('a3', 'failed', 5000);

      INSERT INTO monitoring_snapshots (
        containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down
      ) VALUES (8, 3, 1, 2, 1);

      INSERT INTO monitoring_cycles (duration_ms) VALUES (1800), (950);
    `);

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
  });

  it('enforces bearer token only when configured', async () => {
    mockConfig.PROMETHEUS_METRICS_ENABLED = true;
    mockConfig.PROMETHEUS_BEARER_TOKEN = 'metrics-token';

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

  it('caches sqlite aggregations for 15 seconds', async () => {
    mockConfig.PROMETHEUS_METRICS_ENABLED = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

    db.exec(`
      INSERT INTO insights (id, severity, category, title, container_name, is_acknowledged)
      VALUES ('i1', 'critical', 'anomaly', 'Anomalous cpu usage on "api"', 'api', 0);
    `);

    let response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toContain('dashboard_insights_total{severity="critical",category="anomaly"} 1');

    db.exec(`
      INSERT INTO insights (id, severity, category, title, container_name, is_acknowledged)
      VALUES ('i2', 'critical', 'anomaly', 'Anomalous cpu usage on "api"', 'api', 0);
    `);

    response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toContain('dashboard_insights_total{severity="critical",category="anomaly"} 1');

    vi.advanceTimersByTime(16_000);

    response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toContain('dashboard_insights_total{severity="critical",category="anomaly"} 2');
  });
});
