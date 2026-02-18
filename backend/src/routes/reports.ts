import type { PoolClient } from 'pg';
import { FastifyInstance } from 'fastify';
import { getMetricsDb } from '../db/timescale.js';
import { ReportsQuerySchema } from '../models/api-schemas.js';
import {
  getInfrastructureServicePatterns,
  matchesInfrastructurePattern,
} from '../services/infrastructure-service-classifier.js';
import { isUndefinedTableError } from '../services/metrics-store.js';
import { selectRollupTable } from '../services/metrics-rollup-selector.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('reports-routes');

// ---------------------------------------------------------------------------
// Result cache — reports aggregate over long windows and don't need real-time
// accuracy. 5-minute TTL gives a meaningful perf win without stale UX.
// ---------------------------------------------------------------------------
const REPORT_CACHE_TTL_MS = 5 * 60 * 1_000;

interface CacheEntry { payload: unknown; expiresAt: number }
const reportCache = new Map<string, CacheEntry>();

function getCachedReport<T>(key: string): T | null {
  const entry = reportCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.payload as T;
}

function setCachedReport(key: string, payload: unknown): void {
  reportCache.set(key, { payload, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
}

/** Clear the report cache (for testing) */
export function clearReportCache(): void {
  reportCache.clear();
}

// ---------------------------------------------------------------------------
// Statement timeout — acquire a single client, set 10 s statement_timeout,
// run the callback, then release. Isolates long report queries from writes.
// ---------------------------------------------------------------------------
async function withStatementTimeout<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = await getMetricsDb();
  const client = await pool.connect();
  try {
    await client.query('SET statement_timeout = 10000');
    return await fn(client);
  } finally {
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}

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

/** Convert a PostgreSQL interval string to milliseconds for rollup table selection. */
function parseDurationMs(interval: string): number {
  const match = /^(\d+)\s+(day|days|hour|hours)$/.exec(interval);
  if (!match) return 24 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  return match[2].startsWith('day') ? n * 24 * 60 * 60 * 1000 : n * 60 * 60 * 1000;
}

function resolveExcludeInfrastructure(query: {
  includeInfrastructure?: boolean;
  excludeInfrastructure?: boolean;
}): boolean {
  if (typeof query.excludeInfrastructure === 'boolean') {
    return query.excludeInfrastructure;
  }
  if (typeof query.includeInfrastructure === 'boolean') {
    return !query.includeInfrastructure;
  }
  return true;
}

function excludeInfrastructureContainers<T extends { container_name: string }>(
  rows: T[],
  excludeInfrastructure: boolean,
  patterns: string[],
): T[] {
  if (!excludeInfrastructure) return rows;
  return rows.filter((row) => !matchesInfrastructurePattern(row.container_name, patterns));
}

function addInfrastructureSqlFilter(
  conditions: string[],
  params: unknown[],
  startParamIdx: number,
  excludeInfrastructure: boolean,
  patterns: string[],
): number {
  if (!excludeInfrastructure) return startParamIdx;

  const infraClauses: string[] = [];
  let paramIdx = startParamIdx;
  for (const name of patterns) {
    infraClauses.push(`LOWER(container_name) = $${paramIdx}`);
    params.push(name);
    paramIdx++;
    infraClauses.push(`LOWER(container_name) LIKE $${paramIdx}`);
    params.push(`${name}-%`);
    paramIdx++;
    infraClauses.push(`LOWER(container_name) LIKE $${paramIdx}`);
    params.push(`${name}_%`);
    paramIdx++;
  }
  conditions.push(`NOT (${infraClauses.join(' OR ')})`);
  return paramIdx;
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
  }, async (request, reply) => {
    try {
    const { timeRange: tr, endpointId, containerId, includeInfrastructure, excludeInfrastructure: rawExcludeInfrastructure } = request.query as {
      timeRange?: string;
      endpointId?: number;
      containerId?: string;
      includeInfrastructure?: boolean;
      excludeInfrastructure?: boolean;
    };
    const excludeInfrastructure = resolveExcludeInfrastructure({
      includeInfrastructure,
      excludeInfrastructure: rawExcludeInfrastructure,
    });
    const includeInfrastructureResolved = !excludeInfrastructure;
    const timeRange = tr || '24h';
    const infrastructurePatterns = await getInfrastructureServicePatterns();

    const cacheKey = `utilization:${timeRange}:${endpointId ?? ''}:${containerId ?? ''}:${excludeInfrastructure}`;
    const cached = getCachedReport<unknown>(cacheKey);
    if (cached) return cached;

    const interval = timeRangeToInterval(timeRange);

    // Auto-select rollup table for the main aggregation query. Percentile
    // queries (percentile_cont) require individual values and must stay on
    // the raw metrics table regardless of time range.
    const now = new Date();
    const from = new Date(now.getTime() - parseDurationMs(interval));
    const rollup = selectRollupTable(from, now);
    const tsCol = rollup.timestampCol;

    const result = await withStatementTimeout(async (client) => {
      const conditions = [`${tsCol} >= NOW() - INTERVAL '${interval}'`];
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
      paramIdx = addInfrastructureSqlFilter(
        conditions,
        params,
        paramIdx,
        excludeInfrastructure,
        infrastructurePatterns,
      );

      const where = conditions.join(' AND ');

      // Main aggregation: use rollup table when available for faster scans.
      // Rollup tables expose avg_value/min_value/max_value/sample_count directly.
      const aggSql = rollup.isRollup
        ? `SELECT
            container_id,
            container_name,
            endpoint_id,
            metric_type,
            AVG(${rollup.valueCol}) as avg_value,
            MIN(min_value) as min_value,
            MAX(max_value) as max_value,
            SUM(sample_count)::int as sample_count
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY container_id, container_name, endpoint_id, metric_type
          ORDER BY container_name, metric_type`
        : `SELECT
            container_id,
            container_name,
            endpoint_id,
            metric_type,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(*)::int as sample_count
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY container_id, container_name, endpoint_id, metric_type
          ORDER BY container_name, metric_type`;

      const { rows } = await client.query(aggSql, params);

      const containersMap = new Map<string, {
        container_id: string;
        container_name: string;
        endpoint_id: number;
        service_type: 'application' | 'infrastructure';
        cpu: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
        memory: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
        memory_bytes: { avg: number; min: number; max: number; p50: number; p95: number; p99: number; samples: number } | null;
      }>();

      for (const row of excludeInfrastructureContainers(rows as AggRow[], excludeInfrastructure, infrastructurePatterns)) {
        const serviceType: 'application' | 'infrastructure' = matchesInfrastructurePattern(
          row.container_name,
          infrastructurePatterns,
        ) ? 'infrastructure' : 'application';
        if (!containersMap.has(row.container_id)) {
          containersMap.set(row.container_id, {
            container_id: row.container_id,
            container_name: row.container_name,
            endpoint_id: row.endpoint_id,
            service_type: serviceType,
            cpu: null,
            memory: null,
            memory_bytes: null,
          });
        }

        // Percentile queries always run against raw metrics (percentile_cont
        // requires individual values that rollup tables do not carry).
        const pConditions = [`container_id = $1`, `metric_type = $2`, `timestamp >= NOW() - INTERVAL '${interval}'`];
        const pParams: unknown[] = [row.container_id, row.metric_type];
        let pIdx = 3;
        if (endpointId) {
          pConditions.push(`endpoint_id = $${pIdx}`);
          pParams.push(endpointId);
          pIdx++;
        }

        const pWhere = pConditions.join(' AND ');
        const { rows: pRows } = await client.query(
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
      const cpuEntries = containers.filter(c => c.cpu);
      const memEntries = containers.filter(c => c.memory);

      const fleetSummary = {
        totalContainers: containers.length,
        avgCpu: cpuEntries.length > 0
          ? Math.round(cpuEntries.reduce((s, c) => s + c.cpu!.avg, 0) / cpuEntries.length * 100) / 100
          : 0,
        maxCpu: cpuEntries.length > 0 ? Math.max(...cpuEntries.map(c => c.cpu!.max)) : 0,
        avgMemory: memEntries.length > 0
          ? Math.round(memEntries.reduce((s, c) => s + c.memory!.avg, 0) / memEntries.length * 100) / 100
          : 0,
        maxMemory: memEntries.length > 0 ? Math.max(...memEntries.map(c => c.memory!.max)) : 0,
      };

      const recommendations = containers
        .filter(c => c.cpu && c.memory)
        .map(c => {
          const issues: string[] = [];
          if (c.cpu!.p95 < 10) issues.push('CPU under-utilized (p95 < 10%) — consider reducing CPU limits');
          if (c.cpu!.avg > 80) issues.push('CPU over-utilized (avg > 80%) — consider increasing CPU limits');
          if (c.memory!.p95 < 20) issues.push('Memory under-utilized (p95 < 20%) — consider reducing memory limits');
          if (c.memory!.avg > 85) issues.push('Memory over-utilized (avg > 85%) — consider increasing memory limits');
          if (issues.length === 0) return null;
          return { container_id: c.container_id, container_name: c.container_name, service_type: c.service_type, issues };
        })
        .filter(Boolean);

      return { timeRange, includeInfrastructure: includeInfrastructureResolved, excludeInfrastructure, containers, fleetSummary, recommendations };
    });

    setCachedReport(cacheKey, result);
    return result;
    } catch (err) {
      if (isUndefinedTableError(err)) {
        log.warn('Metrics table not ready for utilization report');
        return reply.code(503).send({ error: 'Metrics database not ready', details: 'The metrics table has not been created yet.' });
      }
      throw err;
    }
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
  }, async (request, reply) => {
    try {
    const { timeRange: tr, endpointId, containerId, includeInfrastructure, excludeInfrastructure: rawExcludeInfrastructure } = request.query as {
      timeRange?: string;
      endpointId?: number;
      containerId?: string;
      includeInfrastructure?: boolean;
      excludeInfrastructure?: boolean;
    };
    const excludeInfrastructure = resolveExcludeInfrastructure({
      includeInfrastructure,
      excludeInfrastructure: rawExcludeInfrastructure,
    });
    const includeInfrastructureResolved = !excludeInfrastructure;
    const timeRange = tr || '24h';
    const infrastructurePatterns = await getInfrastructureServicePatterns();

    const cacheKey = `trends:${timeRange}:${endpointId ?? ''}:${containerId ?? ''}:${excludeInfrastructure}`;
    const cached = getCachedReport<unknown>(cacheKey);
    if (cached) return cached;

    const interval = timeRangeToInterval(timeRange);

    // Auto-select rollup table: raw metrics for ≤6h, metrics_5min for ≤7d, metrics_1hour for ≤90d
    const now = new Date();
    const from = new Date(now.getTime() - parseDurationMs(interval));
    const rollup = selectRollupTable(from, now);
    const tsCol = rollup.timestampCol;

    const result = await withStatementTimeout(async (client) => {
      const conditions = [`${tsCol} >= NOW() - INTERVAL '${interval}'`];
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
      addInfrastructureSqlFilter(conditions, params, paramIdx, excludeInfrastructure, infrastructurePatterns);

      const where = conditions.join(' AND ');

      const sql = rollup.isRollup
        ? `SELECT time_bucket('1 hour', ${tsCol}) as hour,
            metric_type,
            AVG(${rollup.valueCol}) as avg_value,
            MAX(max_value) as max_value,
            MIN(min_value) as min_value,
            SUM(sample_count)::int as sample_count
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY hour, metric_type
          ORDER BY hour ASC`
        : `SELECT date_trunc('hour', ${tsCol}) as hour,
            metric_type,
            AVG(value) as avg_value,
            MAX(value) as max_value,
            MIN(value) as min_value,
            COUNT(*)::int as sample_count
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY hour, metric_type
          ORDER BY hour ASC`;

      const { rows } = await client.query(sql, params);

      const trends: Record<string, Array<{ hour: string; avg: number; max: number; min: number; samples: number }>> = {
        cpu: [],
        memory: [],
        memory_bytes: [],
      };

      for (const row of rows as Array<{ hour: string; metric_type: string; avg_value: number; max_value: number; min_value: number; sample_count: number }>) {
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

      return { timeRange, includeInfrastructure: includeInfrastructureResolved, excludeInfrastructure, trends };
    });

    setCachedReport(cacheKey, result);
    return result;
    } catch (err) {
      if (isUndefinedTableError(err)) {
        log.warn('Metrics table not ready for trend report');
        return reply.code(503).send({ error: 'Metrics database not ready', details: 'The metrics table has not been created yet.' });
      }
      throw err;
    }
  });

  fastify.get('/api/reports/management', {
    schema: {
      tags: ['Reports'],
      summary: 'Get management report payload contract for PDF generation',
      security: [{ bearerAuth: [] }],
      querystring: ReportsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
    const {
      timeRange: tr,
      endpointId,
      containerId,
      includeInfrastructure,
      excludeInfrastructure: rawExcludeInfrastructure,
    } = request.query as {
      timeRange?: string;
      endpointId?: number;
      containerId?: string;
      includeInfrastructure?: boolean;
      excludeInfrastructure?: boolean;
    };
    const excludeInfrastructure = resolveExcludeInfrastructure({
      includeInfrastructure,
      excludeInfrastructure: rawExcludeInfrastructure,
    });
    const includeInfrastructureResolved = !excludeInfrastructure;
    const timeRange = tr || '7d';
    const interval = timeRangeToInterval(timeRange);
    const infrastructurePatterns = await getInfrastructureServicePatterns();

    const cacheKey = `management:${timeRange}:${endpointId ?? ''}:${containerId ?? ''}:${excludeInfrastructure}`;
    const cached = getCachedReport<unknown>(cacheKey);
    if (cached) return cached;

    // Auto-select rollup table for the management report (top services + daily trends).
    // Both queries aggregate over multi-day windows — rollup tables give a
    // significant scan reduction with no accuracy loss at day granularity.
    const now = new Date();
    const from = new Date(now.getTime() - parseDurationMs(interval));
    const rollup = selectRollupTable(from, now);
    const tsCol = rollup.timestampCol;

    const result = await withStatementTimeout(async (client) => {
      const baseConditions = [`${tsCol} >= NOW() - INTERVAL '${interval}'`];
      const baseParams: unknown[] = [];
      let paramIdx = 1;

      if (endpointId) {
        baseConditions.push(`endpoint_id = $${paramIdx}`);
        baseParams.push(endpointId);
        paramIdx++;
      }
      if (containerId) {
        baseConditions.push(`container_id = $${paramIdx}`);
        baseParams.push(containerId);
        paramIdx++;
      }
      addInfrastructureSqlFilter(baseConditions, baseParams, paramIdx, excludeInfrastructure, infrastructurePatterns);
      const where = baseConditions.join(' AND ');

      // Top-services query: use rollup avg_value/max_value when available.
      const topServicesSql = rollup.isRollup
        ? `SELECT
            container_id,
            container_name,
            endpoint_id,
            AVG(CASE WHEN metric_type = 'cpu' THEN ${rollup.valueCol} END) as cpu_avg,
            MAX(CASE WHEN metric_type = 'cpu' THEN max_value END) as cpu_max,
            AVG(CASE WHEN metric_type = 'memory' THEN ${rollup.valueCol} END) as memory_avg,
            MAX(CASE WHEN metric_type = 'memory' THEN max_value END) as memory_max
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY container_id, container_name, endpoint_id`
        : `SELECT
            container_id,
            container_name,
            endpoint_id,
            AVG(CASE WHEN metric_type = 'cpu' THEN value END) as cpu_avg,
            MAX(CASE WHEN metric_type = 'cpu' THEN value END) as cpu_max,
            AVG(CASE WHEN metric_type = 'memory' THEN value END) as memory_avg,
            MAX(CASE WHEN metric_type = 'memory' THEN value END) as memory_max
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY container_id, container_name, endpoint_id`;

      const { rows: topRows } = await client.query(topServicesSql, baseParams);

      const topServices = (topRows as Array<{
        container_id: string;
        container_name: string;
        endpoint_id: number;
        cpu_avg: number | null;
        cpu_max: number | null;
        memory_avg: number | null;
        memory_max: number | null;
      }>)
        .map((row) => ({
          containerId: row.container_id,
          containerName: row.container_name,
          endpointId: row.endpoint_id,
          cpuAvg: Math.round(Number(row.cpu_avg || 0) * 100) / 100,
          cpuMax: Math.round(Number(row.cpu_max || 0) * 100) / 100,
          memoryAvg: Math.round(Number(row.memory_avg || 0) * 100) / 100,
          memoryMax: Math.round(Number(row.memory_max || 0) * 100) / 100,
        }))
        .sort((a, b) => (b.cpuAvg + b.memoryAvg) - (a.cpuAvg + a.memoryAvg))
        .slice(0, 10);

      const cpuAvgValues = topServices.map((s) => s.cpuAvg);
      const cpuMaxValues = topServices.map((s) => s.cpuMax);
      const memoryAvgValues = topServices.map((s) => s.memoryAvg);
      const memoryMaxValues = topServices.map((s) => s.memoryMax);

      // Daily trend query: rollup tables can be grouped by day directly.
      const trendSql = rollup.isRollup
        ? `SELECT
            time_bucket('1 day', ${tsCol}) as day,
            metric_type,
            AVG(${rollup.valueCol}) as avg_value,
            MIN(min_value) as min_value,
            MAX(max_value) as max_value,
            SUM(sample_count)::int as sample_count
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY day, metric_type
          ORDER BY day ASC`
        : `SELECT
            date_trunc('day', ${tsCol}) as day,
            metric_type,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(*)::int as sample_count
          FROM ${rollup.table}
          WHERE ${where}
          GROUP BY day, metric_type
          ORDER BY day ASC`;

      const { rows: trendRows } = await client.query(trendSql, baseParams);

      const weeklyTrends: Record<string, Array<{ day: string; avg: number; min: number; max: number; samples: number }>> = {
        cpu: [],
        memory: [],
      };

      for (const row of trendRows as Array<{ day: string; metric_type: string; avg_value: number; min_value: number; max_value: number; sample_count: number }>) {
        if (row.metric_type !== 'cpu' && row.metric_type !== 'memory') continue;
        weeklyTrends[row.metric_type].push({
          day: row.day,
          avg: Math.round(Number(row.avg_value) * 100) / 100,
          min: Math.round(Number(row.min_value) * 100) / 100,
          max: Math.round(Number(row.max_value) * 100) / 100,
          samples: row.sample_count,
        });
      }

      const recommendations = topServices
        .flatMap((service) => {
          const items: Array<{ title: string; detail: string; severity: 'info' | 'warning' | 'critical' }> = [];
          if (service.cpuAvg > 80) {
            items.push({
              title: `High CPU usage detected in ${service.containerName}`,
              detail: `Average CPU is ${service.cpuAvg}% over selected time range.`,
              severity: 'warning',
            });
          }
          if (service.memoryAvg > 85) {
            items.push({
              title: `High memory usage detected in ${service.containerName}`,
              detail: `Average memory is ${service.memoryAvg}% over selected time range.`,
              severity: 'warning',
            });
          }
          return items;
        })
        .slice(0, 10);

      return {
        reportType: 'management',
        generatedAt: new Date().toISOString(),
        scope: {
          timeRange,
          endpointId: endpointId ?? null,
          containerId: containerId ?? null,
          includeInfrastructure: includeInfrastructureResolved,
          excludeInfrastructure,
        },
        executiveSummary: {
          totalServices: topServices.length,
          avgCpu: cpuAvgValues.length
            ? Math.round((cpuAvgValues.reduce((sum, value) => sum + value, 0) / cpuAvgValues.length) * 100) / 100
            : 0,
          maxCpu: cpuMaxValues.length ? Math.max(...cpuMaxValues) : 0,
          avgMemory: memoryAvgValues.length
            ? Math.round((memoryAvgValues.reduce((sum, value) => sum + value, 0) / memoryAvgValues.length) * 100) / 100
            : 0,
          maxMemory: memoryMaxValues.length ? Math.max(...memoryMaxValues) : 0,
          anomalyCount: recommendations.length,
        },
        weeklyTrends,
        topServices,
        topInsights: recommendations,
      };
    });

    setCachedReport(cacheKey, result);
    return result;
    } catch (err) {
      if (isUndefinedTableError(err)) {
        log.warn('Metrics table not ready for management report');
        return reply.code(503).send({ error: 'Metrics database not ready', details: 'The metrics table has not been created yet.' });
      }
      throw err;
    }
  });
}
