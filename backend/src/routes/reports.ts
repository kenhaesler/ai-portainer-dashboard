import { FastifyInstance } from 'fastify';
import { getMetricsDb } from '../db/timescale.js';
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

function timeRangeToInterval(timeRange: string): string {
  switch (timeRange) {
    case '24h': return '1 day';
    case '7d': return '7 days';
    case '30d': return '30 days';
    default: return '1 day';
  }
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

    const db = await getMetricsDb();
    const interval = timeRangeToInterval(timeRange);

    const conditions = [`timestamp >= NOW() - INTERVAL '${interval}'`];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (endpointId) {
      conditions.push(`endpoint_id = $${paramIdx}`);
      params.push(endpointId);
      paramIdx++;
    }
    if (containerId) {
      conditions.push(`container_id = $${paramIdx}`);
      params.push(containerId);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    // Aggregate stats per container per metric type
    const { rows } = await db.query(
      `SELECT
        container_id,
        container_name,
        endpoint_id,
        metric_type,
        AVG(value) as avg_value,
        MIN(value) as min_value,
        MAX(value) as max_value,
        COUNT(*)::int as sample_count
      FROM metrics
      WHERE ${where}
      GROUP BY container_id, container_name, endpoint_id, metric_type
      ORDER BY container_name, metric_type`,
      params,
    );

    // Compute percentiles per container per metric type using PostgreSQL
    const containersMap = new Map<string, {
      container_id: string;
      container_name: string;
      endpoint_id: number;
      cpu: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
      memory: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
      memory_bytes: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
    }>();

    for (const row of rows as AggRow[]) {
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

      // Use PostgreSQL percentile_cont for efficient percentile calculation
      const pConditions = [`container_id = $1`, `metric_type = $2`, `timestamp >= NOW() - INTERVAL '${interval}'`];
      const pParams: unknown[] = [row.container_id, row.metric_type];
      let pIdx = 3;
      if (endpointId) {
        pConditions.push(`endpoint_id = $${pIdx}`);
        pParams.push(endpointId);
        pIdx++;
      }

      const pWhere = pConditions.join(' AND ');
      const { rows: pRows } = await db.query(
        `SELECT
          percentile_cont(0.50) WITHIN GROUP (ORDER BY value) as p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY value) as p95,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY value) as p99
        FROM metrics
        WHERE ${pWhere}`,
        pParams,
      );

      const pResult = pRows[0] ?? { p50: 0, p95: 0, p99: 0 };

      const entry = containersMap.get(row.container_id)!;
      const stats = {
        avg: Math.round(Number(row.avg_value) * 100) / 100,
        min: Math.round(Number(row.min_value) * 100) / 100,
        max: Math.round(Number(row.max_value) * 100) / 100,
        p50: Math.round(Number(pResult.p50) * 100) / 100,
        p95: Math.round(Number(pResult.p95) * 100) / 100,
        p99: Math.round(Number(pResult.p99) * 100) / 100,
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

    const db = await getMetricsDb();
    const interval = timeRangeToInterval(timeRange);

    const conditions = [`timestamp >= NOW() - INTERVAL '${interval}'`];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (endpointId) {
      conditions.push(`endpoint_id = $${paramIdx}`);
      params.push(endpointId);
      paramIdx++;
    }
    if (containerId) {
      conditions.push(`container_id = $${paramIdx}`);
      params.push(containerId);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    // Hourly aggregation using date_trunc
    const { rows } = await db.query(
      `SELECT
        date_trunc('hour', timestamp)::text as hour,
        metric_type,
        AVG(value) as avg_value,
        MAX(value) as max_value,
        MIN(value) as min_value,
        COUNT(*)::int as sample_count
      FROM metrics
      WHERE ${where}
      GROUP BY hour, metric_type
      ORDER BY hour ASC`,
      params,
    );

    // Group by metric type
    const trends: Record<string, Array<{
      hour: string;
      avg: number;
      max: number;
      min: number;
      samples: number;
    }>> = { cpu: [], memory: [], memory_bytes: [] };

    for (const row of rows as Array<{
      hour: string;
      metric_type: string;
      avg_value: number;
      max_value: number;
      min_value: number;
      sample_count: number;
    }>) {
      const entry = {
        hour: row.hour,
        avg: Math.round(Number(row.avg_value) * 100) / 100,
        max: Math.round(Number(row.max_value) * 100) / 100,
        min: Math.round(Number(row.min_value) * 100) / 100,
        samples: row.sample_count,
      };
      if (trends[row.metric_type]) {
        trends[row.metric_type].push(entry);
      }
    }

    return { timeRange, trends };
  });
}
