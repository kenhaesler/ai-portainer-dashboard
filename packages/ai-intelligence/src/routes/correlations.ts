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
export const MAX_CORRELATIONS_CACHE = 500;

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

/** @internal Exported for testing only */
export function setCachedCorrelations(key: string, payload: unknown): void {
  if (correlationsCache.size >= MAX_CORRELATIONS_CACHE) {
    const firstKey = correlationsCache.keys().next().value;
    if (firstKey) correlationsCache.delete(firstKey);
  }
  correlationsCache.set(key, { payload, expiresAt: Date.now() + CORRELATIONS_CACHE_TTL_MS });
}

/** Clear the correlations cache (for testing) */
export function clearCorrelationsCache(): void {
  correlationsCache.clear();
}

/** Returns current correlations cache size (for testing) */
export function getCorrelationsCacheSize(): number {
  return correlationsCache.size;
}

// ---------------------------------------------------------------------------
// Periodic TTL sweep — removes expired-but-unread entries so they don't waste
// memory up to the FIFO cap.  Runs every 5 minutes.  The timer is unref()'d
// so it never prevents Node from exiting gracefully.
// ---------------------------------------------------------------------------
const SWEEP_INTERVAL_MS = 5 * 60 * 1_000;

function sweepExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of correlationsCache) {
    if (entry.expiresAt <= now) {
      correlationsCache.delete(key);
    }
  }
  for (const [key, entry] of insightsCache) {
    if (entry.expiresAt <= now) {
      insightsCache.delete(key);
    }
  }
}

// The sweep timer is started lazily when the correlation routes are registered
// (see correlationRoutes) rather than at module load, so merely importing this
// module — including transitively via a package barrel — starts no background
// timer (#1533).
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic TTL sweep. Idempotent; called from route registration. */
export function startCacheSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepExpiredEntries, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

/** Stop the periodic TTL sweep (for testing / clean shutdown) */
export function stopCacheSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** @internal Exported for testing only */
export { sweepExpiredEntries as _sweepExpiredEntries };

// Simple in-memory cache for LLM insights (15 min TTL)
const INSIGHTS_TTL = 15 * 60 * 1000;
export const MAX_INSIGHTS_CACHE = 500;
interface InsightsCacheEntry extends CorrelationInsightsResult { expiresAt: number }
const insightsCache = new Map<string, InsightsCacheEntry>();

/** Clear the insights cache (for testing) */
export function clearInsightsCache() {
  insightsCache.clear();
}

/** Returns current insights cache size (for testing) */
export function getInsightsCacheSize(): number {
  return insightsCache.size;
}

/** @internal Exported for testing only */
export function setCachedInsights(
  key: string,
  insights: CorrelationInsight[],
  summary: string | null,
  narrative: Pick<CorrelationInsightsResult, 'narrativeStatus' | 'narrativeUnavailableReason'> = {
    narrativeStatus: 'ok',
    narrativeUnavailableReason: null,
  },
): void {
  if (insightsCache.size >= MAX_INSIGHTS_CACHE) {
    const firstKey = insightsCache.keys().next().value;
    if (firstKey) insightsCache.delete(firstKey);
  }
  insightsCache.set(key, {
    insights,
    summary,
    narrativeStatus: narrative.narrativeStatus,
    narrativeUnavailableReason: narrative.narrativeUnavailableReason,
    expiresAt: Date.now() + INSIGHTS_TTL,
  });
}

export interface CorrelationInsight {
  /**
   * Stable key for the (containerA, containerB, metric) triple this narrative
   * belongs to, so a client can join narratives onto its own pair list instead
   * of relying on array position. Both sides slice their own top-10 from
   * independently filtered lists, so position is not a safe join key.
   * Format: `containerA|containerB|metricType`.
   */
  pairKey: string;
  containerA: string;
  containerB: string;
  metricType: string;
  correlation: number;
  narrative: string | null;
}

/**
 * Why the narratives are missing, when they are.
 * - `ok`      — every pair got a narrative.
 * - `partial` — some pairs did; the rest are null.
 * - `unparsed`— the model answered but nothing could be attributed to a pair.
 * - `unavailable` — the model call failed.
 */
export type NarrativeStatus = 'ok' | 'partial' | 'unparsed' | 'unavailable';

export interface CorrelationInsightsResult {
  insights: CorrelationInsight[];
  summary: string | null;
  narrativeStatus: NarrativeStatus;
  /**
   * One operator-facing sentence explaining a non-`ok` status, for the UI to
   * render ONCE above the list — not once per row. Null when status is `ok`.
   */
  narrativeUnavailableReason: string | null;
}

/** Join key shared with the client. Container names cannot contain `|`. */
export function correlationPairKey(containerA: string, containerB: string, metricType: string): string {
  return `${containerA}|${containerB}|${metricType}`;
}

const NARRATIVE_REASONS: Record<Exclude<NarrativeStatus, 'ok'>, string> = {
  partial: 'The model returned narratives for only some pairs. The correlation values below are computed from metrics and are unaffected.',
  unparsed: 'The model returned a response that could not be matched to any container pair. The correlation values below are computed from metrics and are unaffected.',
  unavailable: 'Could not reach the language model. Check LLM_API_URL and LLM_API_TOKEN under Settings → AI. The correlation values below are computed from metrics and are unaffected.',
};

/** Strip markdown emphasis / stray list punctuation the model may wrap text in. */
function cleanNarrative(text: string): string | null {
  const cleaned = text
    .replace(/^[\s*_`>#-]+/, '')
    .replace(/[\s*_`]+$/, '')
    .trim();
  // Two characters is not a narrative; treat it as nothing rather than render it.
  return cleaned.length >= 3 ? cleaned : null;
}

interface ResponseBlocks {
  /** Blocks the model numbered explicitly, keyed by that number. */
  indexed: Map<number, string>;
  /** Unnumbered blocks, split on blank lines so multi-line paragraphs stay whole. */
  paragraphs: string[];
  /** One entry per non-empty line, markers stripped. */
  lineBlocks: string[];
}

// `**1.** text`, `1) text`, `2 - text`, `Pair 3: text`, `#4 text`
const INDEX_MARKER = /^[\s*_`#>-]*(?:pair\s*)?(\d{1,2})\s*[.):\]\-–]\s*(.*)$/i;
const BULLET_MARKER = /^\s*[-*•]\s+(.*)$/;

/**
 * Segment a model response three ways so attribution can pick whichever
 * segmentation actually lines up with the pairs.
 *
 * Accepts the ordinary shapes models produce: `1.`, `1)`, `1:`, `1 -`,
 * `**1.**`, `#1`, `Pair 1:`, `-`/`*`/`•` bullets, and prose. Lines following a
 * marker without one of their own belong to that marker's block.
 */
function splitResponseBlocks(lines: string[]): ResponseBlocks {
  const indexed = new Map<number, string>();
  const paragraphs: string[] = [];
  const lineBlocks: string[] = [];

  let current: { index: number | null; parts: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.parts.join(' ').trim();
    if (text) {
      if (current.index !== null) indexed.set(current.index, text);
      else paragraphs.push(text);
    }
    current = null;
  };

  for (const line of lines) {
    if (!line) { flush(); continue; }

    const asIndexed = INDEX_MARKER.exec(line);
    if (asIndexed) {
      flush();
      current = { index: Number(asIndexed[1]), parts: asIndexed[2] ? [asIndexed[2]] : [] };
      if (asIndexed[2]) lineBlocks.push(asIndexed[2].trim());
      continue;
    }

    const asBullet = BULLET_MARKER.exec(line);
    if (asBullet) {
      flush();
      current = { index: null, parts: [asBullet[1]] };
      lineBlocks.push(asBullet[1].trim());
      continue;
    }

    lineBlocks.push(line);
    if (current) current.parts.push(line);
    else current = { index: null, parts: [line] };
  }
  flush();

  return { indexed, paragraphs, lineBlocks };
}

/** True when a block names both containers of a pair — strong enough to attribute by content. */
function mentionsBothContainers(block: string, pair: CorrelationPair): boolean {
  const haystack = block.toLowerCase();
  const a = pair.containerA.name.toLowerCase();
  const b = pair.containerB.name.toLowerCase();
  return a.length > 2 && b.length > 2 && haystack.includes(a) && haystack.includes(b);
}

export function buildCorrelationPrompt(pairs: CorrelationPair[]): string {
  const pairDescriptions = pairs.map((p, i) => {
    const dir = p.direction === 'positive' ? 'positively' : 'inversely';
    return `${i + 1}. ${p.containerA.name} ↔ ${p.containerB.name}: ${p.metricType.toUpperCase()} correlation r=${p.correlation.toFixed(3)} (${dir} correlated, ${p.strength.replace('_', ' ')}, ${p.sampleCount} samples)`;
  }).join('\n');

  return `Analyze these cross-container metric correlations and explain what each relationship likely means for a DevOps operator. For each pair, explain in 1-2 sentences why these containers might be correlated and what action (if any) the operator should take. Then provide a 2-sentence fleet-wide summary. Do NOT use markdown, bullet points, or headings — just numbered explanations matching the pairs, followed by the summary on a new line starting with "SUMMARY:".

${pairDescriptions}`;
}

/**
 * Attribute the model's narratives to correlation pairs.
 *
 * The previous implementation matched only a line literally starting with `N.`
 * or `N)`. Any other formatting — a bulleted list, bold numbering, plain
 * paragraphs, a leading preamble — nulled every narrative at once, and the UI
 * printed the same "Insight unavailable" line ten times with no cause. This
 * version tries, in order of how much evidence it has:
 *
 *  1. explicit list indices (robust to reordering and to a missing entry),
 *  2. container names appearing in a block (attribution by content),
 *  3. positional blocks, but ONLY when the block count matches the pair count —
 *     otherwise a single unstructured answer would be pinned to pair 1 and
 *     silently presented as its explanation.
 *
 * Anything it cannot attribute stays null and is reported through
 * `narrativeStatus` / `narrativeUnavailableReason` so the caller can say why
 * once instead of rendering a failure per row.
 */
export function parseInsightsResponse(
  response: string,
  pairs: CorrelationPair[],
): CorrelationInsightsResult {
  // Blank lines are kept: they are the only paragraph boundary the model gives us.
  const lines = response.split('\n').map(l => l.trim());
  // Tolerate `SUMMARY:`, `**SUMMARY:**`, `## Summary:` etc.
  const summaryIdx = lines.findIndex(l => /^[\s*_`#>-]*summary\s*:/i.test(l));
  const summary = summaryIdx >= 0
    ? cleanNarrative(lines[summaryIdx].replace(/^[\s*_`#>-]*summary\s*:/i, ''))
    : null;
  const narrativeLines = summaryIdx >= 0 ? lines.slice(0, summaryIdx) : lines;

  const { indexed, paragraphs, lineBlocks } = splitResponseBlocks(narrativeLines);

  const narratives: Array<string | null> = pairs.map((_, idx) => {
    const block = indexed.get(idx + 1);
    return block ? cleanNarrative(block) : null;
  });

  // Content-based attribution for anything the index pass missed: a block that
  // names both containers of a pair is evidence, not a guess. Each block is
  // claimed at most once.
  const claimed = new Set<string>();
  for (const narrative of narratives) if (narrative) claimed.add(narrative);
  pairs.forEach((pair, idx) => {
    if (narratives[idx]) return;
    for (const candidates of [lineBlocks, paragraphs]) {
      const match = candidates.find((block) => !claimed.has(block) && mentionsBothContainers(block, pair));
      if (match) {
        narratives[idx] = cleanNarrative(match);
        claimed.add(match);
        return;
      }
    }
  });

  // Positional fallback — only when a segmentation's block count matches the
  // pair count exactly, so an unstructured answer is never pinned to pair 1 and
  // presented as its explanation.
  const attributedAny = narratives.some((n) => n !== null);
  if (pairs.length > 0 && !attributedAny) {
    const positional = [paragraphs, lineBlocks].find((blocks) => blocks.length === pairs.length);
    positional?.forEach((block, idx) => { narratives[idx] = cleanNarrative(block); });
  }

  const insights: CorrelationInsight[] = pairs.map((pair, idx) => ({
    pairKey: correlationPairKey(pair.containerA.name, pair.containerB.name, pair.metricType),
    containerA: pair.containerA.name,
    containerB: pair.containerB.name,
    metricType: pair.metricType,
    correlation: pair.correlation,
    narrative: narratives[idx],
  }));

  const withNarrative = narratives.filter(Boolean).length;
  const narrativeStatus: NarrativeStatus = pairs.length === 0 || withNarrative === pairs.length
    ? 'ok'
    : withNarrative === 0
      ? 'unparsed'
      : 'partial';

  if (narrativeStatus !== 'ok') {
    log.warn(
      { pairCount: pairs.length, withNarrative, responsePreview: response.slice(0, 200) },
      'Correlation narratives could not be fully attributed to pairs',
    );
  }

  return {
    insights,
    summary,
    narrativeStatus,
    narrativeUnavailableReason: narrativeStatus === 'ok' ? null : NARRATIVE_REASONS[narrativeStatus],
  };
}

export async function correlationRoutes(fastify: FastifyInstance, opts: CorrelationRoutesOpts) {
  // Start the correlations-cache TTL sweep now that the routes are actually
  // being registered (the timer no longer runs on bare module import — #1533).
  startCacheSweep();

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
      return {
        insights: cached.insights,
        summary: cached.summary,
        narrativeStatus: cached.narrativeStatus,
        narrativeUnavailableReason: cached.narrativeUnavailableReason,
        pairsTotal: cached.insights.length,
      };
    }

    // Compute correlations (wrapped in statement timeout for expensive pairwise query)
    const pairs = await withStatementTimeout((client) =>
      opts.findCorrelatedContainers(safeHours, safeMin, client),
    );
    if (pairs.length === 0) {
      return { insights: [], summary: null, narrativeStatus: 'ok' as const, narrativeUnavailableReason: null, pairsTotal: 0 };
    }

    // Limit to top 10 pairs for LLM prompt. `pairsTotal` travels with the
    // response so a client that sliced its own top-10 from a differently
    // filtered list can tell that the two lists are not the same set; every
    // insight also carries `pairKey`, so narratives are joined by identity
    // rather than by array position.
    const topPairs = pairs.slice(0, 10);
    const prompt = buildCorrelationPrompt(topPairs);

    try {
      const response = await chatStream(
        [{ role: 'user', content: prompt }],
        await getEffectivePrompt('correlation_insights'),
        () => {},
        'correlation_insights',
      );

      const parsed = parseInsightsResponse(response.trim(), topPairs);
      setCachedInsights(cacheKey, parsed.insights, parsed.summary, parsed);
      return { ...parsed, pairsTotal: pairs.length };
    } catch (err) {
      log.warn({ err }, 'Failed to generate correlation insights');
      // Correlations are computed from metrics and stand on their own; return
      // them with an explicit reason the narratives are missing so the UI can
      // say it once instead of printing a failure per row.
      const fallbackInsights: CorrelationInsight[] = topPairs.map(p => ({
        pairKey: correlationPairKey(p.containerA.name, p.containerB.name, p.metricType),
        containerA: p.containerA.name,
        containerB: p.containerB.name,
        metricType: p.metricType,
        correlation: p.correlation,
        narrative: null,
      }));
      return {
        insights: fallbackInsights,
        summary: null,
        narrativeStatus: 'unavailable' as const,
        narrativeUnavailableReason: NARRATIVE_REASONS.unavailable,
        pairsTotal: pairs.length,
      };
    }
  });
}
