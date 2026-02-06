import { FastifyInstance } from 'fastify';
import { getConfig } from '../config/index.js';
import { getDb } from '../db/sqlite.js';

const CACHE_TTL_MS = 15_000;

interface MetricsSnapshot {
  insights: Array<{ severity: string; category: string; total: number }>;
  anomalies: Array<{ container_name: string; metric_type: string; total: number }>;
  actions: Array<{ status: string; total: number }>;
  snapshot: {
    containers_running: number;
    containers_stopped: number;
    containers_unhealthy: number;
    endpoints_up: number;
    endpoints_down: number;
  };
  activeAnomalies: number;
  remediationDurations: number[];
  monitoringDurations: number[];
}

let cache: { expiresAt: number; snapshot: MetricsSnapshot } | null = null;

export function resetPrometheusMetricsCacheForTests(): void {
  cache = null;
}

function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function normalizeInsightCategory(category: string): string {
  if (category.startsWith('security')) return 'security';
  if (category === 'anomaly' || category === 'ai-analysis') return category;
  return 'ai-analysis';
}

function formatLabels(labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabel(value)}"`);
  return `{${parts.join(',')}}`;
}

function renderMetricWithLabels(
  lines: string[],
  name: string,
  labels: Record<string, string>,
  value: number,
): void {
  lines.push(`${name}${formatLabels(labels)} ${Number.isFinite(value) ? value : 0}`);
}

function renderMetric(lines: string[], name: string, value: number): void {
  lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
}

function renderHistogram(
  lines: string[],
  name: string,
  help: string,
  buckets: number[],
  observations: number[],
): void {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} histogram`);

  const finite = observations.filter((value) => Number.isFinite(value) && value >= 0);
  const sorted = [...finite].sort((a, b) => a - b);

  let cumulative = 0;
  let index = 0;
  for (const bucket of buckets) {
    while (index < sorted.length && sorted[index] <= bucket) {
      cumulative += 1;
      index += 1;
    }
    lines.push(`${name}_bucket{le="${bucket}"} ${cumulative}`);
  }

  lines.push(`${name}_bucket{le="+Inf"} ${sorted.length}`);
  renderMetric(lines, `${name}_sum`, sorted.reduce((sum, value) => sum + value, 0));
  renderMetric(lines, `${name}_count`, sorted.length);
}

function getCachedSnapshot(): MetricsSnapshot {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.snapshot;
  }

  const db = getDb();

  const insights = db.prepare(
    `SELECT severity, category, COUNT(*) as total
     FROM insights
     GROUP BY severity, category`,
  ).all() as Array<{ severity: string; category: string; total: number }>;

  const anomalies = db.prepare(
    `SELECT
       container_name,
       CASE
         WHEN lower(title) LIKE '%cpu%' THEN 'cpu'
         WHEN lower(title) LIKE '%memory%' THEN 'memory'
         ELSE 'unknown'
       END as metric_type,
       COUNT(*) as total
     FROM insights
     WHERE category = 'anomaly'
       AND container_name IS NOT NULL
     GROUP BY container_name, metric_type`,
  ).all() as Array<{ container_name: string; metric_type: string; total: number }>;

  const actions = db.prepare(
    `SELECT status, COUNT(*) as total
     FROM actions
     GROUP BY status`,
  ).all() as Array<{ status: string; total: number }>;

  const snapshot = db.prepare(
    `SELECT containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down
     FROM monitoring_snapshots
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get() as MetricsSnapshot['snapshot'] | undefined;

  const activeAnomalies = db.prepare(
    `SELECT COUNT(*) as count
     FROM insights
     WHERE category = 'anomaly' AND is_acknowledged = 0`,
  ).get() as { count: number };

  const remediationDurations = db.prepare(
    `SELECT execution_duration_ms
     FROM actions
     WHERE status IN ('completed', 'failed')
       AND execution_duration_ms IS NOT NULL`,
  ).all() as Array<{ execution_duration_ms: number }>;

  const monitoringDurations = db.prepare(
    `SELECT duration_ms FROM monitoring_cycles`,
  ).all() as Array<{ duration_ms: number }>;

  const snapshotData: MetricsSnapshot = {
    insights,
    anomalies,
    actions,
    snapshot: snapshot ?? {
      containers_running: 0,
      containers_stopped: 0,
      containers_unhealthy: 0,
      endpoints_up: 0,
      endpoints_down: 0,
    },
    activeAnomalies: activeAnomalies.count,
    remediationDurations: remediationDurations.map((row) => row.execution_duration_ms / 1000),
    monitoringDurations: monitoringDurations.map((row) => row.duration_ms / 1000),
  };

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    snapshot: snapshotData,
  };

  return snapshotData;
}

function buildMetricsPayload(): string {
  const snapshot = getCachedSnapshot();
  const lines: string[] = [];

  lines.push('# HELP dashboard_insights_total Total AI insights generated');
  lines.push('# TYPE dashboard_insights_total counter');
  for (const row of snapshot.insights) {
    renderMetricWithLabels(lines, 'dashboard_insights_total', {
      severity: row.severity,
      category: normalizeInsightCategory(row.category),
    }, row.total);
  }

  lines.push('# HELP dashboard_anomalies_detected_total Total anomalies detected');
  lines.push('# TYPE dashboard_anomalies_detected_total counter');
  for (const row of snapshot.anomalies) {
    renderMetricWithLabels(lines, 'dashboard_anomalies_detected_total', {
      container_name: row.container_name,
      metric_type: row.metric_type,
    }, row.total);
  }

  lines.push('# HELP dashboard_remediation_actions_total Remediation action counts');
  lines.push('# TYPE dashboard_remediation_actions_total counter');
  for (const row of snapshot.actions) {
    renderMetricWithLabels(lines, 'dashboard_remediation_actions_total', {
      status: row.status,
    }, row.total);
  }

  lines.push('# HELP dashboard_containers_total Current container counts by state');
  lines.push('# TYPE dashboard_containers_total gauge');
  renderMetricWithLabels(lines, 'dashboard_containers_total', { state: 'running' }, snapshot.snapshot.containers_running);
  renderMetricWithLabels(lines, 'dashboard_containers_total', { state: 'stopped' }, snapshot.snapshot.containers_stopped);
  renderMetricWithLabels(lines, 'dashboard_containers_total', { state: 'unhealthy' }, snapshot.snapshot.containers_unhealthy);

  lines.push('# HELP dashboard_endpoints_total Endpoint health');
  lines.push('# TYPE dashboard_endpoints_total gauge');
  renderMetricWithLabels(lines, 'dashboard_endpoints_total', { status: 'up' }, snapshot.snapshot.endpoints_up);
  renderMetricWithLabels(lines, 'dashboard_endpoints_total', { status: 'down' }, snapshot.snapshot.endpoints_down);

  lines.push('# HELP dashboard_active_anomalies Currently unacknowledged anomalies');
  lines.push('# TYPE dashboard_active_anomalies gauge');
  renderMetric(lines, 'dashboard_active_anomalies', snapshot.activeAnomalies);

  renderHistogram(
    lines,
    'dashboard_remediation_duration_seconds',
    'Time from approval to completion',
    [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
    snapshot.remediationDurations,
  );

  renderHistogram(
    lines,
    'dashboard_monitoring_cycle_duration_seconds',
    'Monitoring cycle execution time',
    [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    snapshot.monitoringDurations,
  );

  lines.push('# HELP process_resident_memory_bytes Resident memory in bytes');
  lines.push('# TYPE process_resident_memory_bytes gauge');
  renderMetric(lines, 'process_resident_memory_bytes', process.memoryUsage().rss);

  lines.push('# HELP process_heap_used_bytes Heap memory currently used in bytes');
  lines.push('# TYPE process_heap_used_bytes gauge');
  renderMetric(lines, 'process_heap_used_bytes', process.memoryUsage().heapUsed);

  lines.push('# HELP process_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE process_uptime_seconds gauge');
  renderMetric(lines, 'process_uptime_seconds', process.uptime());

  return `${lines.join('\n')}\n`;
}

export async function prometheusRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (request, reply) => {
    const config = getConfig();

    if (!config.PROMETHEUS_METRICS_ENABLED) {
      return reply.code(404).send({ error: 'Prometheus metrics endpoint is disabled' });
    }

    if (config.PROMETHEUS_BEARER_TOKEN) {
      const authHeader = request.headers.authorization;
      const expected = `Bearer ${config.PROMETHEUS_BEARER_TOKEN}`;
      if (authHeader !== expected) {
        return reply
          .code(401)
          .header('www-authenticate', 'Bearer')
          .send({ error: 'Unauthorized' });
      }
    }

    return reply
      .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(buildMetricsPayload());
  });
}
