import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import * as insightsStore from './insights-store.js';
import type { InsightInsert } from './insights-store.js';

const log = createChildLogger('trace-anomaly');

/**
 * Trace-driven anomaly detection — flags latency (p95) and error-rate
 * regressions per service using a recent (1m bucket) vs baseline (1h bucket
 * over 24h) comparison.
 *
 * @remarks
 * The ai-intelligence package is forbidden from importing observability
 * directly (`packages/ai-intelligence/src/CLAUDE.md`). The `computeRed`
 * function is therefore injected by the composition root
 * (`packages/server/src/wiring.ts`), preserving the strict package boundary
 * while letting the cycle reuse the existing RED query service.
 */

export interface RedRow {
  group: string;
  rate: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  callCount: number;
}

export interface RedBucket {
  bucketStart: string;
  rows: RedRow[];
}

export interface RedResult {
  buckets: RedBucket[];
  truncated: boolean;
}

export interface ComputeRedQuery {
  from: Date;
  to: Date;
  bucket: '1m' | '5m' | '1h';
  groupBy: 'service' | 'route' | 'container' | 'namespace';
}

export type ComputeRedFn = (q: ComputeRedQuery) => Promise<RedResult>;

export interface TraceAnomalyDeps {
  computeRed: ComputeRedFn;
}

// Rate-limit log lines: at most 1 per series per minute.
const LOG_THROTTLE_MS = 60_000;
const lastLoggedAt = new Map<string, number>();

/** Test hook: clear log throttle state between tests. */
export function __resetTraceAnomalyLogState(): void {
  lastLoggedAt.clear();
}

function shouldLog(seriesKey: string): boolean {
  const now = Date.now();
  const last = lastLoggedAt.get(seriesKey) ?? 0;
  if (now - last < LOG_THROTTLE_MS) return false;
  lastLoggedAt.set(seriesKey, now);
  return true;
}

function meanAndStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, std: 0 };
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function collectBaselineSeries(
  baseline: RedResult,
  field: 'p95Ms' | 'errorRate',
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const bucket of baseline.buckets) {
    for (const row of bucket.rows) {
      const arr = out.get(row.group) ?? [];
      arr.push(row[field]);
      out.set(row.group, arr);
    }
  }
  return out;
}

function latestRowPerGroup(recent: RedResult): Map<string, RedRow> {
  const out = new Map<string, RedRow>();
  // Buckets come back ordered by bucket_start ASC; last occurrence wins.
  for (const bucket of recent.buckets) {
    for (const row of bucket.rows) {
      out.set(row.group, row);
    }
  }
  return out;
}

/**
 * One pass of trace-driven anomaly detection. Safe to call from a scheduler;
 * any failure (DB down, empty result) is swallowed and logged.
 */
export async function runTraceAnomalyCycle(deps: TraceAnomalyDeps): Promise<void> {
  const config = getConfig();
  // Defensive defaults — if config was cached before these vars existed
  // (older tests / hot-reload), fall back to the canonical defaults.
  const zThreshold = config.TRACES_ANOMALY_P95_ZSCORE ?? 2.5;
  const errorRatePct = config.TRACES_ANOMALY_ERROR_RATE_PCT ?? 5;

  let recent: RedResult;
  let baseline: RedResult;
  try {
    const now = new Date();
    const recentFrom = new Date(now.getTime() - 60 * 60 * 1000); // 1h window, 1m buckets
    const baselineFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h window, 1h buckets

    [recent, baseline] = await Promise.all([
      deps.computeRed({ from: recentFrom, to: now, bucket: '1m', groupBy: 'service' }),
      deps.computeRed({ from: baselineFrom, to: now, bucket: '1h', groupBy: 'service' }),
    ]);
  } catch (err) {
    log.warn({ err }, 'trace-anomaly cycle skipped: computeRed failed');
    return;
  }

  const latest = latestRowPerGroup(recent);
  const p95Baselines = collectBaselineSeries(baseline, 'p95Ms');
  const errorBaselines = collectBaselineSeries(baseline, 'errorRate');

  const insights: InsightInsert[] = [];

  for (const [service, row] of latest) {
    // ─── Latency p95 ─────────────────────────────────────────────────────
    const p95Series = p95Baselines.get(service) ?? [];
    if (p95Series.length >= 3) {
      const { mean, std } = meanAndStd(p95Series);
      // When std == 0 (perfectly stable baseline) z-score is undefined; use a
      // relative deviation rule instead — flag if recent is > 2x baseline mean
      // and at least 50ms above it (avoids tiny-value noise).
      let zScore: number;
      let isAnomalous: boolean;
      if (std > 0) {
        zScore = (row.p95Ms - mean) / std;
        isAnomalous = zScore > zThreshold;
      } else {
        const tolerance = Math.max(mean * 0.5, 50);
        zScore = mean > 0 ? (row.p95Ms - mean) / Math.max(tolerance, 1) : 0;
        isAnomalous = mean > 0 && row.p95Ms > mean + tolerance;
      }
      if (isAnomalous) {
        const seriesKey = `latency_p95:${service}`;
        if (shouldLog(seriesKey)) {
          log.warn(
            { service, p95Ms: row.p95Ms, baselineMean: mean, baselineStd: std, zScore },
            'trace latency p95 anomaly',
          );
        }
        insights.push({
          id: uuidv4(),
          endpoint_id: null,
          endpoint_name: null,
          container_id: null,
          container_name: null,
          severity: zScore > zThreshold * 2 ? 'critical' : 'warning',
          category: 'anomaly',
          title: `High latency p95 on service "${service}"`,
          description:
            `Recent p95: ${row.p95Ms.toFixed(1)}ms ` +
            `(baseline mean: ${mean.toFixed(1)}ms, std: ${std.toFixed(1)}ms, ` +
            `z-score: ${zScore.toFixed(2)}). Latency is ${Math.abs(zScore).toFixed(1)} ` +
            `standard deviations above the 24h baseline.`,
          suggested_action:
            'Inspect the Calls tab for the affected service to identify slow endpoints, and check downstream dependencies.',
          metric_type: 'latency_p95',
          detection_method: 'ml-anomaly',
        });
      }
    }

    // ─── Error rate ──────────────────────────────────────────────────────
    const errSeries = errorBaselines.get(service) ?? [];
    const recentRatePct = row.errorRate * 100;
    if (recentRatePct >= errorRatePct) {
      // Compare against the baseline mean as well — only flag if it's clearly
      // worse than what the service usually emits.
      const baselineMeanPct = errSeries.length > 0
        ? (errSeries.reduce((a, b) => a + b, 0) / errSeries.length) * 100
        : 0;
      if (recentRatePct > baselineMeanPct + 1 /* percentage points slack */) {
        const seriesKey = `error_rate:${service}`;
        if (shouldLog(seriesKey)) {
          log.warn(
            { service, errorRate: row.errorRate, baselineMeanPct },
            'trace error-rate anomaly',
          );
        }
        insights.push({
          id: uuidv4(),
          endpoint_id: null,
          endpoint_name: null,
          container_id: null,
          container_name: null,
          severity: recentRatePct >= errorRatePct * 2 ? 'critical' : 'warning',
          category: 'anomaly',
          title: `Elevated error rate on service "${service}"`,
          description:
            `Recent error rate: ${recentRatePct.toFixed(2)}% ` +
            `(baseline: ${baselineMeanPct.toFixed(2)}%, threshold: ${errorRatePct}%).`,
          suggested_action:
            'Open the Trace Explorer for this service and inspect failed spans for the root cause.',
          metric_type: 'error_rate',
          detection_method: 'ml-anomaly',
        });
      }
    }
  }

  if (insights.length === 0) return;
  try {
    await insightsStore.insertInsights(insights);
  } catch (err) {
    log.warn({ err, count: insights.length }, 'failed to insert trace anomalies');
  }
}
