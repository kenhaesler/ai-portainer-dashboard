import { FastifyInstance } from 'fastify';
import { getConfig } from '../config/index.js';
import { getDbForDomain } from '../db/app-db-router.js';
import { getPromptGuardNearMissTotal } from '../services/prompt-guard.js';

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

async function getCachedSnapshot(): Promise<MetricsSnapshot> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.snapshot;
  }

  const insightsDb = getDbForDomain('insights');
  const actionsDb = getDbForDomain('actions');
  const monitoringDb = getDbForDomain('monitoring');

  const insights = await insightsDb.query<{ severity: string; category: string; total: number }>(
    `SELECT severity, category, COUNT(*)::integer as total
     FROM insights
     GROUP BY severity, category`,
    [],
  );

  const anomalies = await insightsDb.query<{ container_name: string; metric_type: string; total: number }>(
    `SELECT
       container_name,
       CASE
         WHEN lower(title) LIKE '%cpu%' THEN 'cpu'
         WHEN lower(title) LIKE '%memory%' THEN 'memory'
         ELSE 'unknown'
       END as metric_type,
       COUNT(*)::integer as total
     FROM insights
     WHERE category = 'anomaly'
       AND container_name IS NOT NULL
     GROUP BY container_name, metric_type`,
    [],
  );

  const actions = await actionsDb.query<{ status: string; total: number }>(
    `SELECT status, COUNT(*)::integer as total
     FROM actions
     GROUP BY status`,
    [],
  );

  const snapshot = await monitoringDb.queryOne<MetricsSnapshot['snapshot']>(
    `SELECT containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down
     FROM monitoring_snapshots
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
  );

  const activeAnomalies = await insightsDb.queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer as count
     FROM insights
     WHERE category = 'anomaly' AND is_acknowledged = false`,
    [],
  );

  const remediationDurations = await actionsDb.query<{ execution_duration_ms: number }>(
    `SELECT execution_duration_ms
     FROM actions
     WHERE status IN ('completed', 'failed')
       AND execution_duration_ms IS NOT NULL`,
    [],
  );

  const monitoringDurations = await monitoringDb.query<{ duration_ms: number }>(
    `SELECT duration_ms FROM monitoring_cycles`,
    [],
  );

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
    activeAnomalies: activeAnomalies?.count ?? 0,
    remediationDurations: remediationDurations.map((row) => row.execution_duration_ms / 1000),
    monitoringDurations: monitoringDurations.map((row) => row.duration_ms / 1000),
  };

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    snapshot: snapshotData,
  };

  return snapshotData;
}

async function buildMetricsPayload(): Promise<string> {
  const snapshot = await getCachedSnapshot();
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

  lines.push('# HELP prompt_guard_near_miss_total Prompt injection near-miss detections');
  lines.push('# TYPE prompt_guard_near_miss_total counter');
  renderMetric(lines, 'prompt_guard_near_miss_total', getPromptGuardNearMissTotal());

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

    // In production, require a bearer token of at least 16 characters
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && (!config.PROMETHEUS_BEARER_TOKEN || config.PROMETHEUS_BEARER_TOKEN.length < 16)) {
      return reply
        .code(500)
        .send({ error: 'Prometheus metrics require PROMETHEUS_BEARER_TOKEN (min 16 chars) in production' });
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
      .send(await buildMetricsPayload());
  });
}
