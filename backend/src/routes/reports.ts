import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { ReportsQuerySchema } from '../models/api-schemas.js';

interface AggRow {
  container_id: string;
  container_name: string;
  endpoint_id: number;
  metric_type: string;
  avg_value: number;
  min_value: number;
  max_value: number;
  sample_count: number;
}

function timeRangeToSql(timeRange: string): string {
  switch (timeRange) {
    case '24h': return "-1 day";
    case '7d': return "-7 days";
    case '30d': return "-30 days";
    default: return "-1 day";
  }
}

function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (idx - lower);
}

export async function reportsRoutes(fastify: FastifyInstance) {
  // Fleet utilization report
  fastify.get('/api/reports/utilization', {
    schema: {
      tags: ['Reports'],
      summary: 'Get resource utilization report with aggregations',
      security: [{ bearerAuth: [] }],
      querystring: ReportsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { timeRange: tr, endpointId, containerId } = request.query as {
      timeRange?: string;
      endpointId?: number;
      containerId?: string;
    };
    const timeRange = tr || '24h';

    const db = getDb();
    const sqlRange = timeRangeToSql(timeRange);

    const conditions = ["timestamp >= datetime('now', ?)"];
    const params: unknown[] = [sqlRange];

    if (endpointId) {
      conditions.push('endpoint_id = ?');
      params.push(endpointId);
    }
    if (containerId) {
      conditions.push('container_id = ?');
      params.push(containerId);
    }

    const where = conditions.join(' AND ');

    // Aggregate stats per container per metric type
    const rows = db.prepare(`
      SELECT
        container_id,
        container_name,
        endpoint_id,
        metric_type,
        AVG(value) as avg_value,
        MIN(value) as min_value,
        MAX(value) as max_value,
        COUNT(*) as sample_count
      FROM metrics
      WHERE ${where}
      GROUP BY container_id, metric_type
      ORDER BY container_name, metric_type
    `).all(...params) as AggRow[];

    // Compute percentiles per container per metric type
    const containersMap = new Map<string, {
      container_id: string;
      container_name: string;
      endpoint_id: number;
      cpu: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
      memory: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
      memory_bytes: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
    }>();

    for (const row of rows) {
      if (!containersMap.has(row.container_id)) {
        containersMap.set(row.container_id, {
          container_id: row.container_id,
          container_name: row.container_name,
          endpoint_id: row.endpoint_id,
          cpu: null,
          memory: null,
          memory_bytes: null,
        });
      }

      // Get raw values for percentile computation
      const rawValues = db.prepare(`
        SELECT value FROM metrics
        WHERE container_id = ? AND metric_type = ? AND ${conditions[0]}
        ${endpointId ? 'AND endpoint_id = ?' : ''}
        ORDER BY value ASC
      `).all(
        row.container_id,
        row.metric_type,
        sqlRange,
        ...(endpointId ? [endpointId] : [])
      ) as Array<{ value: number }>;

      const sorted = rawValues.map(v => v.value);

      const entry = containersMap.get(row.container_id)!;
      const stats = {
        avg: Math.round(row.avg_value * 100) / 100,
        min: Math.round(row.min_value * 100) / 100,
        max: Math.round(row.max_value * 100) / 100,
        p50: Math.round(computePercentile(sorted, 50) * 100) / 100,
        p95: Math.round(computePercentile(sorted, 95) * 100) / 100,
        p99: Math.round(computePercentile(sorted, 99) * 100) / 100,
        samples: row.sample_count,
      };

      if (row.metric_type === 'cpu') entry.cpu = stats;
      else if (row.metric_type === 'memory') entry.memory = stats;
      else if (row.metric_type === 'memory_bytes') entry.memory_bytes = stats;
    }

    const containers = Array.from(containersMap.values());

    // Fleet summary
    const cpuEntries = containers.filter(c => c.cpu);
    const memEntries = containers.filter(c => c.memory);

    const fleetSummary = {
      totalContainers: containers.length,
      avgCpu: cpuEntries.length > 0
        ? Math.round(cpuEntries.reduce((s, c) => s + c.cpu!.avg, 0) / cpuEntries.length * 100) / 100
        : 0,
      maxCpu: cpuEntries.length > 0
        ? Math.max(...cpuEntries.map(c => c.cpu!.max))
        : 0,
      avgMemory: memEntries.length > 0
        ? Math.round(memEntries.reduce((s, c) => s + c.memory!.avg, 0) / memEntries.length * 100) / 100
        : 0,
      maxMemory: memEntries.length > 0
        ? Math.max(...memEntries.map(c => c.memory!.max))
        : 0,
    };

    // Right-sizing recommendations
    const recommendations = containers
      .filter(c => c.cpu && c.memory)
      .map(c => {
        const issues: string[] = [];
        if (c.cpu!.p95 < 10) issues.push('CPU under-utilized (p95 < 10%) — consider reducing CPU limits');
        if (c.cpu!.avg > 80) issues.push('CPU over-utilized (avg > 80%) — consider increasing CPU limits');
        if (c.memory!.p95 < 20) issues.push('Memory under-utilized (p95 < 20%) — consider reducing memory limits');
        if (c.memory!.avg > 85) issues.push('Memory over-utilized (avg > 85%) — consider increasing memory limits');
        if (issues.length === 0) return null;
        return {
          container_id: c.container_id,
          container_name: c.container_name,
          issues,
        };
      })
      .filter(Boolean);

    return {
      timeRange,
      containers,
      fleetSummary,
      recommendations,
    };
  });

  // Trend data endpoint — hourly aggregation for charts
  fastify.get('/api/reports/trends', {
    schema: {
      tags: ['Reports'],
      summary: 'Get hourly trend data for charts',
      security: [{ bearerAuth: [] }],
      querystring: ReportsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { timeRange: tr, endpointId, containerId } = request.query as {
      timeRange?: string;
      endpointId?: number;
      containerId?: string;
    };
    const timeRange = tr || '24h';

    const db = getDb();
    const sqlRange = timeRangeToSql(timeRange);

    const conditions = ["timestamp >= datetime('now', ?)"];
    const params: unknown[] = [sqlRange];

    if (endpointId) {
      conditions.push('endpoint_id = ?');
      params.push(endpointId);
    }
    if (containerId) {
      conditions.push('container_id = ?');
      params.push(containerId);
    }

    const where = conditions.join(' AND ');

    // Hourly aggregation
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00:00', timestamp) as hour,
        metric_type,
        AVG(value) as avg_value,
        MAX(value) as max_value,
        MIN(value) as min_value,
        COUNT(*) as sample_count
      FROM metrics
      WHERE ${where}
      GROUP BY hour, metric_type
      ORDER BY hour ASC
    `).all(...params) as Array<{
      hour: string;
      metric_type: string;
      avg_value: number;
      max_value: number;
      min_value: number;
      sample_count: number;
    }>;

    // Group by metric type
    const trends: Record<string, Array<{
      hour: string;
      avg: number;
      max: number;
      min: number;
      samples: number;
    }>> = { cpu: [], memory: [], memory_bytes: [] };

    for (const row of rows) {
      const entry = {
        hour: row.hour,
        avg: Math.round(row.avg_value * 100) / 100,
        max: Math.round(row.max_value * 100) / 100,
        min: Math.round(row.min_value * 100) / 100,
        samples: row.sample_count,
      };
      if (trends[row.metric_type]) {
        trends[row.metric_type].push(entry);
      }
    }

    return { timeRange, trends };
  });
}
