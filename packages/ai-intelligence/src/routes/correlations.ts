import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { getMetricsDb } from '@dashboard/core/db/timescale.js';
import { chatStream } from '../services/llm-client.js';
import { getEffectivePrompt } from '../services/prompt-store.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('routes:correlations');

// ---------------------------------------------------------------------------
// Interfaces for injected observability functions
// ---------------------------------------------------------------------------

export interface Queryable {
  query: <T = any>(...args: any[]) => Promise<{ rows: T[] }>;
}

export interface CorrelationPair {
  containerA: { id?: string; name: string };
  containerB: { id?: string; name: string };
  metricType: string;
  correlation: number;
  direction: 'positive' | 'negative';
  strength: string;
  sampleCount: number;
}

export interface CorrelationRoutesOpts {
  detectCorrelatedAnomalies: (windowSize: number, minScore: number, client: Queryable) => Promise<unknown>;
  findCorrelatedContainers: (hours: number, minCorrelation: number, client: Queryable) => Promise<CorrelationPair[]>;
  isUndefinedTableError: (err: unknown) => boolean;
}

const AnomalyCorrelationQuerySchema = z.object({
  windowSize: z.coerce.number().optional().default(30),
  minScore: z.coerce.number().optional().default(2),
});

const CorrelationsQuerySchema = z.object({
  hours: z.coerce.number().optional().default(24),
  minCorrelation: z.coerce.number().optional().default(0.7),
});

// ---------------------------------------------------------------------------
// Statement timeout — acquire a single client, set 10 s statement_timeout,
// run the callback, then release. The timeout protects against runaway
// correlation queries (O(n²) pairwise) that previously ran unbounded.
// ---------------------------------------------------------------------------
async function withStatementTimeout<T>(
  fn: (client: Queryable) => Promise<T>,
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

// ---------------------------------------------------------------------------
// Result cache — correlation queries are expensive (O(n²) pairwise) and
// don't require real-time accuracy. 5-minute TTL matches reports cache.
// ---------------------------------------------------------------------------
const CORRELATIONS_CACHE_TTL_MS = 5 * 60 * 1_000;

interface CorrelationsCacheEntry { payload: unknown; expiresAt: number }
const correlationsCache = new Map<string, CorrelationsCacheEntry>();

function getCachedCorrelations<T>(key: string): T | null {
  const entry = correlationsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    correlationsCache.delete(key);
    return null;
  }
  return entry.payload as T;
}

function setCachedCorrelations(key: string, payload: unknown): void {
  correlationsCache.set(key, { payload, expiresAt: Date.now() + CORRELATIONS_CACHE_TTL_MS });
}

/** Clear the correlations cache (for testing) */
export function clearCorrelationsCache(): void {
  correlationsCache.clear();
}

// Simple in-memory cache for LLM insights (15 min TTL)
const INSIGHTS_TTL = 15 * 60 * 1000;
const insightsCache = new Map<string, { insights: CorrelationInsight[]; summary: string | null; expiresAt: number }>();

/** Clear the insights cache (for testing) */
export function clearInsightsCache() {
  insightsCache.clear();
}

export interface CorrelationInsight {
  containerA: string;
  containerB: string;
  metricType: string;
  correlation: number;
  narrative: string | null;
}

export function buildCorrelationPrompt(pairs: CorrelationPair[]): string {
  const pairDescriptions = pairs.map((p, i) => {
    const dir = p.direction === 'positive' ? 'positively' : 'inversely';
    return `${i + 1}. ${p.containerA.name} ↔ ${p.containerB.name}: ${p.metricType.toUpperCase()} correlation r=${p.correlation.toFixed(3)} (${dir} correlated, ${p.strength.replace('_', ' ')}, ${p.sampleCount} samples)`;
  }).join('\n');

  return `Analyze these cross-container metric correlations and explain what each relationship likely means for a DevOps operator. For each pair, explain in 1-2 sentences why these containers might be correlated and what action (if any) the operator should take. Then provide a 2-sentence fleet-wide summary. Do NOT use markdown, bullet points, or headings — just numbered explanations matching the pairs, followed by the summary on a new line starting with "SUMMARY:".

${pairDescriptions}`;
}

export function parseInsightsResponse(
  response: string,
  pairs: CorrelationPair[],
): { insights: CorrelationInsight[]; summary: string | null } {
  const lines = response.split('\n').map(l => l.trim()).filter(Boolean);
  const summaryIdx = lines.findIndex(l => l.toUpperCase().startsWith('SUMMARY:'));
  const summary = summaryIdx >= 0 ? lines[summaryIdx].replace(/^SUMMARY:\s*/i, '').trim() : null;
  const narrativeLines = summaryIdx >= 0 ? lines.slice(0, summaryIdx) : lines;

  const insights: CorrelationInsight[] = pairs.map((pair, idx) => {
    // Try to find line starting with "N." or "N)"
    const prefix = `${idx + 1}.`;
    const prefixAlt = `${idx + 1})`;
    const matchLine = narrativeLines.find(l => l.startsWith(prefix) || l.startsWith(prefixAlt));
    const narrative = matchLine
      ? matchLine.replace(/^\d+[.)]\s*/, '').trim()
      : null;

    return {
      containerA: pair.containerA.name,
      containerB: pair.containerB.name,
      metricType: pair.metricType,
      correlation: pair.correlation,
      narrative,
    };
  });

  return { insights, summary };
}

export async function correlationRoutes(fastify: FastifyInstance, opts: CorrelationRoutesOpts) {
  // Existing within-container correlated anomalies endpoint
  fastify.get('/api/anomalies/correlated', {
    schema: {
      tags: ['Anomalies'],
      summary: 'Get multi-metric correlated anomalies',
      security: [{ bearerAuth: [] }],
      querystring: AnomalyCorrelationQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { windowSize, minScore } = request.query as z.infer<typeof AnomalyCorrelationQuerySchema>;

    const cacheKey = `anomalies:${windowSize}:${minScore}`;
    const cached = getCachedCorrelations<unknown>(cacheKey);
    if (cached) return cached;

    try {
      const result = await withStatementTimeout((client) =>
        opts.detectCorrelatedAnomalies(windowSize, minScore, client),
      );
      setCachedCorrelations(cacheKey, result);
      return result;
    } catch (err) {
      if (opts.isUndefinedTableError(err)) {
        log.warn('Metrics table not ready for correlated anomalies');
        return reply.code(503).send({ error: 'Metrics database not ready', details: 'The metrics table has not been created yet.' });
      }
      throw err;
    }
  });

  // Cross-container correlation pairs
  fastify.get('/api/metrics/correlations', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get cross-container correlation pairs',
      security: [{ bearerAuth: [] }],
      querystring: CorrelationsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { hours, minCorrelation } = request.query as z.infer<typeof CorrelationsQuerySchema>;
    const safeHours = Math.max(1, Math.min(168, Math.floor(hours)));
    const safeMin = Math.max(0.5, Math.min(1, minCorrelation));

    const cacheKey = `pairs:${safeHours}:${safeMin}`;
    const cached = getCachedCorrelations<unknown>(cacheKey);
    if (cached) return cached;

    try {
      const startedAt = Date.now();
      const pairs = await withStatementTimeout((client) =>
        opts.findCorrelatedContainers(safeHours, safeMin, client),
      );
      log.info({ hours: safeHours, minCorrelation: safeMin, pairCount: pairs.length, durationMs: Date.now() - startedAt }, 'Computed cross-container correlations');
      const result = { pairs };
      setCachedCorrelations(cacheKey, result);
      return result;
    } catch (err) {
      if (opts.isUndefinedTableError(err)) {
        log.warn('Metrics table not ready for correlation pairs');
        return reply.code(503).send({ error: 'Metrics database not ready', details: 'The metrics table has not been created yet.' });
      }
      throw err;
    }
  });

  // LLM-generated insights for correlation pairs
  fastify.get('/api/metrics/correlations/insights', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get AI-generated insights for cross-container correlations',
      security: [{ bearerAuth: [] }],
      querystring: CorrelationsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { hours, minCorrelation } = request.query as z.infer<typeof CorrelationsQuerySchema>;
    const safeHours = Math.max(1, Math.min(168, Math.floor(hours)));
    const safeMin = Math.max(0.5, Math.min(1, minCorrelation));

    // Check cache
    const cacheKey = `${safeHours}:${safeMin}`;
    const cached = insightsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { insights: cached.insights, summary: cached.summary };
    }

    // Compute correlations (wrapped in statement timeout for expensive pairwise query)
    const pairs = await withStatementTimeout((client) =>
      opts.findCorrelatedContainers(safeHours, safeMin, client),
    );
    if (pairs.length === 0) {
      return { insights: [], summary: null };
    }

    // Limit to top 10 pairs for LLM prompt
    const topPairs = pairs.slice(0, 10);
    const prompt = buildCorrelationPrompt(topPairs);

    try {
      const response = await chatStream(
        [{ role: 'user', content: prompt }],
        await getEffectivePrompt('correlation_insights'),
        () => {},
      );

      const { insights, summary } = parseInsightsResponse(response.trim(), topPairs);
      insightsCache.set(cacheKey, { insights, summary, expiresAt: Date.now() + INSIGHTS_TTL });
      return { insights, summary };
    } catch (err) {
      log.warn({ err }, 'Failed to generate correlation insights');
      // Return pairs without narratives
      const fallbackInsights: CorrelationInsight[] = topPairs.map(p => ({
        containerA: p.containerA.name,
        containerB: p.containerB.name,
        metricType: p.metricType,
        correlation: p.correlation,
        narrative: null,
      }));
      return { insights: fallbackInsights, summary: null };
    }
  });
}
