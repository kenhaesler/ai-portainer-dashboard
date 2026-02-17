import { FastifyInstance } from 'fastify';
import { getMetricsDb } from '../db/timescale.js';
import { ContainerParamsSchema, MetricsQuerySchema, MetricsResponseSchema, AnomaliesQuerySchema } from '../models/api-schemas.js';
import { getNetworkRates, getAllNetworkRates, isUndefinedTableError } from '../services/metrics-store.js';
import { getRatesForEndpoint, getAllRates } from '../services/network-rate-tracker.js';
import { selectRollupTable } from '../services/metrics-rollup-selector.js';
import { decimateLTTB } from '../services/lttb-decimator.js';
import { chatStream, isOllamaAvailable } from '../services/llm-client.js';
import { getEffectivePrompt } from '../services/prompt-store.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('metrics-routes');

function parseTimeRange(timeRange: string): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  let from = new Date(now);

  const match = timeRange.match(/^(\d+)([mhd])$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 'm': from.setMinutes(from.getMinutes() - value); break;
      case 'h': from.setHours(from.getHours() - value); break;
      case 'd': from.setDate(from.getDate() - value); break;
    }
  } else {
    // Default to 1 hour
    from.setHours(from.getHours() - 1);
  }

  return { from, to };
}

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/metrics/:endpointId/:containerId', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get container metrics time series',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
      querystring: MetricsQuerySchema,
      response: { 200: MetricsResponseSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as { endpointId: number; containerId: string };
    const query = request.query as {
      metricType?: string;
      timeRange?: string;
      metric_type?: string;
      from?: string;
      to?: string;
    };

    // Support both naming conventions
    const metricType = query.metricType || query.metric_type;
    const timeRange = query.timeRange || '1h';

    try {
      const db = await getMetricsDb();

      // Parse timeRange or use explicit from/to
      let fromDate: Date;
      let toDate: Date;
      if (query.from) {
        fromDate = new Date(query.from);
        toDate = query.to ? new Date(query.to) : new Date();
      } else {
        const parsed = parseTimeRange(timeRange);
        fromDate = parsed.from;
        toDate = parsed.to;
      }

      // Auto-select rollup table
      const rollup = selectRollupTable(fromDate, toDate);

      const conditions = [`endpoint_id = $1`, `(container_id = $2 OR container_id LIKE $3)`];
      const params: unknown[] = [endpointId, containerId, `${containerId}%`];
      let paramIdx = 4;

      if (metricType) {
        conditions.push(`metric_type = $${paramIdx}`);
        params.push(metricType);
        paramIdx++;
      }

      conditions.push(`${rollup.timestampCol} >= $${paramIdx}`);
      params.push(fromDate.toISOString());
      paramIdx++;

      conditions.push(`${rollup.timestampCol} <= $${paramIdx}`);
      params.push(toDate.toISOString());

      const where = conditions.join(' AND ');
      const { rows: metrics } = await db.query<{ timestamp: string; value: number }>(
        `SELECT ${rollup.timestampCol} as timestamp, ${rollup.valueCol}::double precision as value
         FROM ${rollup.table} WHERE ${where}
         ORDER BY ${rollup.timestampCol} ASC
         LIMIT 5000`,
        params,
      );

      // Apply LTTB decimation for raw data
      const decimated = !rollup.isRollup
        ? decimateLTTB(metrics as Array<{ timestamp: string; value: number }>, 500)
        : metrics;

      if (decimated.length === 0) {
        log.debug({ endpointId, containerId, metricType, timeRange }, 'Metrics query returned zero rows');
      }

      // Return in format expected by frontend
      return {
        containerId,
        endpointId,
        metricType: metricType || 'cpu',
        timeRange,
        data: decimated,
      };
    } catch (err) {
      if (isUndefinedTableError(err)) {
        log.warn({ endpointId, containerId }, 'Metrics table not ready — TimescaleDB migrations may not have run');
        return (reply as any).code(503).send({ error: 'Metrics database not ready', details: 'The metrics table has not been created yet. TimescaleDB migrations may still be pending.' });
      }
      log.error({ err, endpointId, containerId }, 'Failed to query metrics');
      return (reply as any).code(500).send({ error: 'Failed to query metrics', details: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  fastify.get('/api/metrics/anomalies', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get recent anomaly detections',
      security: [{ bearerAuth: [] }],
      querystring: AnomaliesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { limit = 50 } = request.query as { limit?: number };
    try {
      const db = await getMetricsDb();

      const { rows: recentMetrics } = await db.query(
        `SELECT m1.*,
          (SELECT AVG(value) FROM metrics m2
           WHERE m2.container_id = m1.container_id
           AND m2.metric_type = m1.metric_type
           AND m2.timestamp > m1.timestamp - INTERVAL '1 hour'
          ) as avg_value
        FROM metrics m1
        WHERE m1.timestamp > NOW() - INTERVAL '24 hours'
        ORDER BY m1.timestamp DESC
        LIMIT $1`,
        [limit],
      );

      return { anomalies: recentMetrics };
    } catch (err) {
      if (isUndefinedTableError(err)) {
        log.warn('Metrics table not ready for anomaly query');
        return reply.code(503).send({ error: 'Metrics database not ready', details: 'The metrics table has not been created yet.' });
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to query anomalies');
      return reply.code(500).send({ error: 'Failed to query anomalies', details: msg });
    }
  });

  fastify.get('/api/metrics/network-rates/:endpointId', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get network I/O rates for all containers in an endpoint',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId } = request.params as { endpointId: string };
    const eid = Number(endpointId);
    try {
      const rates = await getNetworkRates(eid);
      // If TimescaleDB returned data, use it; otherwise fall through to live tracker
      if (Object.keys(rates).length > 0) {
        return { rates };
      }
    } catch {
      // TimescaleDB unavailable — fall through to in-memory tracker
      log.debug({ endpointId }, 'TimescaleDB unavailable for network rates, using in-memory tracker');
    }
    // Fallback: in-memory rates computed from scheduler's Docker stats collection
    const rates = getRatesForEndpoint(eid);
    return { rates };
  });

  // Network rates across all endpoints (for "All endpoints" view)
  fastify.get('/api/metrics/network-rates', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get network I/O rates for all containers across all endpoints',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    try {
      const rates = await getAllNetworkRates();
      if (Object.keys(rates).length > 0) {
        return { rates };
      }
    } catch {
      log.debug('TimescaleDB unavailable for all network rates, using in-memory tracker');
    }
    const rates = getAllRates();
    return { rates };
  });

  // AI-powered metrics summary (SSE streaming)
  fastify.get('/api/metrics/:endpointId/:containerId/ai-summary', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get AI-generated natural language summary of container metrics',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
      querystring: MetricsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as { endpointId: number; containerId: string };
    const query = request.query as { timeRange?: string };
    const timeRange = query.timeRange || '1h';

    // Check LLM availability
    const available = await isOllamaAvailable();
    if (!available) {
      return reply.code(503).send({ error: 'LLM service unavailable' });
    }

    // Gather metrics data for prompt
    const db = await getMetricsDb();
    const { from } = parseTimeRange(timeRange);

    const { rows: metricsRows } = await db.query<{
      metric_type: string;
      avg_value: number;
      min_value: number;
      max_value: number;
      sample_count: number;
    }>(`
      SELECT metric_type,
        AVG(value) as avg_value,
        MIN(value) as min_value,
        MAX(value) as max_value,
        COUNT(*) as sample_count
      FROM metrics
      WHERE container_id = $1 AND timestamp >= $2
      GROUP BY metric_type
    `, [containerId, from.toISOString()]);

    // Get container name
    const { rows: nameRows } = await db.query<{ container_name: string }>(`
      SELECT DISTINCT container_name FROM metrics
      WHERE container_id = $1 LIMIT 1
    `, [containerId]);

    const containerName = nameRows[0]?.container_name || containerId.slice(0, 12);

    // Build metrics context
    const metricsContext = metricsRows.map(r => {
      const unit = r.metric_type === 'memory_bytes' ? ' MB' : '%';
      const divisor = r.metric_type === 'memory_bytes' ? 1024 * 1024 : 1;
      return `- ${r.metric_type}: avg=${(r.avg_value / divisor).toFixed(1)}${unit}, min=${(r.min_value / divisor).toFixed(1)}${unit}, max=${(r.max_value / divisor).toFixed(1)}${unit} (${r.sample_count} samples)`;
    }).join('\n');

    // Check for anomalies (values > 80% for cpu/memory)
    const { rows: anomalyRows } = await db.query<{ count: string }>(`
      SELECT COUNT(*) as count FROM metrics
      WHERE container_id = $1 AND timestamp >= $2
        AND metric_type IN ('cpu', 'memory') AND value > 80
    `, [containerId, from.toISOString()]);
    const anomalyCount = { count: Number(anomalyRows[0]?.count ?? 0) };

    const systemPrompt = await getEffectivePrompt('metrics_summary');

    const userPrompt = `Summarize the metrics for container "${containerName}" over the last ${timeRange}:

${metricsContext || 'No metrics data available for this time range.'}

Anomalous readings (>80%): ${anomalyCount.count}
Time range: ${timeRange}
Endpoint ID: ${endpointId}`;

    // Hijack response to bypass Fastify compression/serialization for SSE.
    // reply.hijack() also bypasses @fastify/cors, so add CORS headers manually.
    // The preflight OPTIONS is handled normally by @fastify/cors, so if we reach
    // here the origin was already validated.
    const origin = request.headers.origin;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
      } : {}),
    });

    try {
      await chatStream(
        [{ role: 'user', content: userPrompt }],
        systemPrompt,
        (chunk: string) => {
          reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        },
      );
      reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      log.error({ err, containerId }, 'AI summary stream failed');
      reply.raw.write(`data: ${JSON.stringify({ error: 'AI summary generation failed' })}\n\n`);
    }

    reply.raw.end();
  });
}
