import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import * as insightsStore from './insights-store.js';
import type { InsightInsert } from './insights-store.js';
import { classifyCv, cvThresholdMultiplier, meanAndStd } from './anomaly-stats.js';

const log = createChildLogger('trace-anomaly');

/**
 * Trace-driven anomaly detection — flags latency (p95) and error-rate
 * regressions per service.
 *
 * Two algorithmic improvements (issue #1295):
 *
 *   • Fix 2 — CV-based variance scaling. The effective z-score threshold for
 *     the latency-p95 signal is scaled by the coefficient of variation of
 *     the baseline window. Naturally noisy services (CV ≥ 0.3) get a 1.5×
 *     headroom; medium-CV (0.1–0.3) get 1.2×; stable series (CV < 0.1) keep
 *     the base threshold. See `anomaly-stats.ts`.
 *
 *   • Fix 3 — Hour-of-day baseline. Instead of a single flat 24h baseline,
 *     the detector now compares the recent observation against the baseline
 *     for the **same hour-of-day** computed over the last N days
 *     (configurable via ANOMALY_HOUROFDAY_LOOKBACK_DAYS, default 14). The
 *     flat 24h baseline survives as a warm-up fallback: when the hour
 *     bucket has fewer than ANOMALY_HOUROFDAY_MIN_SAMPLES samples we
 *     gracefully degrade to the legacy behaviour rather than flag noise.
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
  /** Test-only clock injection. Defaults to `new Date()`. */
  now?: () => Date;
}

// Rate-limit log lines: at most 1 per series per minute.
const LOG_THROTTLE_MS = 60_000;
const lastLoggedAt = new Map<string, number>();

// Suppress duplicate anomaly inserts for the same (service, metric_type) when
// the underlying problem is persistent. 10 minutes mirrors the cooldown the
// existing metric anomaly detector uses for ongoing conditions.
const COOLDOWN_MS = 10 * 60 * 1000;
const lastInsertedAt = new Map<string, number>();

// Per-service rate limit (#1294, fix 7). A single noisy service must not be
// able to emit two anomalies (e.g. latency_p95 *and* error_rate) back to back
// — the per-key cooldown above is per-(service,metric_type), so without this
// ceiling a service flapping on both signals doubles its alert volume.
const lastServiceInsertAt = new Map<string, number>();

/** Test hook: clear log throttle and cooldown state between tests. */
export function __resetTraceAnomalyLogState(): void {
  lastLoggedAt.clear();
  lastInsertedAt.clear();
  lastServiceInsertAt.clear();
}

function shouldLog(seriesKey: string): boolean {
  const now = Date.now();
  const last = lastLoggedAt.get(seriesKey) ?? 0;
  if (now - last < LOG_THROTTLE_MS) return false;
  lastLoggedAt.set(seriesKey, now);
  return true;
}

function inCooldown(seriesKey: string): boolean {
  const last = lastInsertedAt.get(seriesKey);
  if (last === undefined) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function inServiceRateLimit(service: string, windowMs: number): boolean {
  if (windowMs <= 0) return false;
  const last = lastServiceInsertAt.get(service);
  if (last === undefined) return false;
  return Date.now() - last < windowMs;
}

function markInserted(seriesKey: string, service: string): void {
  const now = Date.now();
  lastInsertedAt.set(seriesKey, now);
  lastServiceInsertAt.set(service, now);
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

/**
 * Index a baseline result by service and hour-of-day so the detector can pick
 * the correct distribution for the recent observation.
 *
 * Bucket boundary is UTC. The `bucketStart` from `computeRed` is already a
 * date_bin output, so parsing as ISO + `getUTCHours()` gives a stable key
 * independent of the server local timezone.
 */
function collectHourlyBaselineSeries(
  baseline: RedResult,
  field: 'p95Ms' | 'errorRate',
): Map<string, Map<number, number[]>> {
  const out = new Map<string, Map<number, number[]>>();
  for (const bucket of baseline.buckets) {
    const hour = new Date(bucket.bucketStart).getUTCHours();
    if (Number.isNaN(hour)) continue;
    for (const row of bucket.rows) {
      let perService = out.get(row.group);
      if (!perService) {
        perService = new Map();
        out.set(row.group, perService);
      }
      const arr = perService.get(hour) ?? [];
      arr.push(row[field]);
      perService.set(hour, arr);
    }
  }
  return out;
}

function latestBucketOfRecent(recent: RedResult): { hour: number; rows: RedRow[] } | null {
  // Buckets come back ordered by bucket_start ASC; the trailing bucket is the
  // most recent observation. Picking the last bucket (rather than scanning
  // every row) preserves the previous "last occurrence wins" semantics but
  // also exposes the hour we should look up.
  const last = recent.buckets[recent.buckets.length - 1];
  if (!last) return null;
  const hour = new Date(last.bucketStart).getUTCHours();
  if (Number.isNaN(hour)) return null;
  return { hour, rows: last.rows };
}

interface BaselineDecision {
  series: number[];
  usedHourOfDay: boolean;
}

/**
 * Resolve the baseline series for a (service, hour) cell with warm-up
 * fallback. Returns `usedHourOfDay: true` when the per-hour bucket is used,
 * `false` when we fell back to the flat 24h window.
 *
 * Exported for tests.
 */
export function pickBaselineSeries(opts: {
  hourly: Map<string, Map<number, number[]>>;
  flat: Map<string, number[]>;
  service: string;
  hour: number;
  minHourSamples: number;
}): BaselineDecision {
  const hourSeries = opts.hourly.get(opts.service)?.get(opts.hour) ?? [];
  if (hourSeries.length >= opts.minHourSamples) {
    return { series: hourSeries, usedHourOfDay: true };
  }
  return { series: opts.flat.get(opts.service) ?? [], usedHourOfDay: false };
}

/**
 * One pass of trace-driven anomaly detection. Safe to call from a scheduler;
 * any failure (DB down, empty result) is swallowed and logged.
 */
export async function runTraceAnomalyCycle(deps: TraceAnomalyDeps): Promise<void> {
  const config = getConfig();
  // Defensive defaults — if config was cached before these vars existed
  // (older tests / hot-reload), fall back to the canonical defaults.
  const zThreshold = config.TRACES_ANOMALY_P95_ZSCORE ?? 3.0;
  const errorRatePct = config.TRACES_ANOMALY_ERROR_RATE_PCT ?? 5;
  // Per-service rate limit (#1294, fix 7). 0 = disabled.
  const perServiceWindowMs =
    (config.TRACES_ANOMALY_PER_SERVICE_MIN ?? 5) * 60 * 1000;
  // Trace-path min-baseline sample count (#1294, fix 8) — mirror of
  // ANOMALY_MIN_SAMPLES on the metric path so brand-new services with
  // sparse baselines do not fire on their first few buckets.
  const minBaselineSamples = config.TRACES_ANOMALY_MIN_SAMPLES ?? 10;
  // Hour-of-day baseline window (#1295, fix 3).
  const lookbackDays = config.ANOMALY_HOUROFDAY_LOOKBACK_DAYS ?? 14;
  const minHourSamples = config.ANOMALY_HOUROFDAY_MIN_SAMPLES ?? 3;

  let recent: RedResult;
  let baseline: RedResult;
  try {
    const now = (deps.now ?? (() => new Date()))();
    const recentFrom = new Date(now.getTime() - 60 * 60 * 1000); // 1h window, 1m buckets
    // Hour-of-day baseline: pull the last `lookbackDays` days bucketed by the
    // hour so we can build per-hour distributions across services. We still
    // request `1h` buckets — `date_bin` aligns each bucket on the hour, and
    // the bucket_start carries the UTC hour we need to key by.
    const baselineFrom = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    [recent, baseline] = await Promise.all([
      deps.computeRed({ from: recentFrom, to: now, bucket: '1m', groupBy: 'service' }),
      deps.computeRed({ from: baselineFrom, to: now, bucket: '1h', groupBy: 'service' }),
    ]);
  } catch (err) {
    log.warn({ err }, 'trace-anomaly cycle skipped: computeRed failed');
    return;
  }

  const latest = latestBucketOfRecent(recent);
  if (!latest) return;

  const flatP95 = collectBaselineSeries(baseline, 'p95Ms');
  const flatErr = collectBaselineSeries(baseline, 'errorRate');
  const hourlyP95 = collectHourlyBaselineSeries(baseline, 'p95Ms');
  const hourlyErr = collectHourlyBaselineSeries(baseline, 'errorRate');

  const insights: InsightInsert[] = [];

  for (const row of latest.rows) {
    const service = row.group;

    // ─── Latency p95 ─────────────────────────────────────────────────────
    const p95Decision = pickBaselineSeries({
      hourly: hourlyP95,
      flat: flatP95,
      service,
      hour: latest.hour,
      minHourSamples,
    });
    // Fix 8 (#1294): require a minimum baseline sample count before
    // evaluating. We keep `>= 3` as a hard floor for safety and additionally
    // require `>= minBaselineSamples` (default 10, mirroring
    // ANOMALY_MIN_SAMPLES). Applies regardless of which baseline (#1295
    // hour-of-day vs flat fallback) `pickBaselineSeries` chose.
    if (p95Decision.series.length >= Math.max(3, minBaselineSamples)) {
      const { mean, std } = meanAndStd(p95Decision.series);
      // Fix 2 (#1295): scale the z-score threshold by CV regime so naturally
      // noisy services do not trip the detector inside their normal envelope.
      const regime = classifyCv(mean, std);
      const scaledZThreshold = zThreshold * cvThresholdMultiplier(regime);


      // When std == 0 (perfectly stable baseline) z-score is undefined; use a
      // relative deviation rule instead — flag if recent is > 2x baseline mean
      // and at least 50ms above it (avoids tiny-value noise).
      let zScore: number;
      let isAnomalous: boolean;
      if (std > 0) {
        zScore = (row.p95Ms - mean) / std;
        isAnomalous = zScore > scaledZThreshold;
      } else {
        const tolerance = Math.max(mean * 0.5, 50);
        zScore = mean > 0 ? (row.p95Ms - mean) / Math.max(tolerance, 1) : 0;
        isAnomalous = mean > 0 && row.p95Ms > mean + tolerance;
      }
      if (isAnomalous) {
        const seriesKey = `latency_p95:${service}`;
        if (shouldLog(seriesKey)) {
          log.warn(
            {
              service,
              p95Ms: row.p95Ms,
              baselineMean: mean,
              baselineStd: std,
              zScore,
              cvRegime: regime,
              threshold: scaledZThreshold,
              usedHourOfDay: p95Decision.usedHourOfDay,
            },
            'trace latency p95 anomaly',
          );
        }
        if (!inCooldown(seriesKey) && !inServiceRateLimit(service, perServiceWindowMs)) {
          markInserted(seriesKey, service);
          insights.push({
            id: uuidv4(),
            endpoint_id: null,
            endpoint_name: null,
            container_id: null,
            // Project the service name into container_name so existing
            // dashboard correlation that groups insights by container surfaces
            // these anomalies alongside metric-driven ones (#1236 AC).
            container_name: service,
            severity: zScore > scaledZThreshold * 2 ? 'critical' : 'warning',
            category: 'anomaly',
            title: `High latency p95 on service "${service}"`,
            description:
              `Recent p95: ${row.p95Ms.toFixed(1)}ms ` +
              `(baseline mean: ${mean.toFixed(1)}ms, std: ${std.toFixed(1)}ms, ` +
              `z-score: ${zScore.toFixed(2)}, threshold: ${scaledZThreshold.toFixed(2)}, ` +
              `cv-regime: ${regime}, baseline: ${p95Decision.usedHourOfDay ? 'hour-of-day' : 'flat'}). ` +
              `Latency is ${Math.abs(zScore).toFixed(1)} standard deviations above the baseline.`,
            suggested_action:
              'Inspect the Calls tab for the affected service to identify slow endpoints, and check downstream dependencies.',
            metric_type: 'latency_p95',
            detection_method: 'ml-anomaly',
          });
        }
      }
    }

    // ─── Error rate ──────────────────────────────────────────────────────
    const errDecision = pickBaselineSeries({
      hourly: hourlyErr,
      flat: flatErr,
      service,
      hour: latest.hour,
      minHourSamples,
    });
    const errSeries = errDecision.series;
    // Fix 8 (#1294): warm-up enforcement on the error-rate branch — skip
    // services that have not accumulated a usable baseline yet, regardless
    // of which baseline (#1295 hour-of-day vs flat fallback) was chosen.
    if (errSeries.length < minBaselineSamples) {
      continue;
    }
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
            { service, errorRate: row.errorRate, baselineMeanPct, usedHourOfDay: errDecision.usedHourOfDay },
            'trace error-rate anomaly',
          );
        }
        if (!inCooldown(seriesKey) && !inServiceRateLimit(service, perServiceWindowMs)) {
          markInserted(seriesKey, service);
          insights.push({
            id: uuidv4(),
            endpoint_id: null,
            endpoint_name: null,
            container_id: null,
            // Same correlation projection as latency_p95 above.
            container_name: service,
            severity: recentRatePct >= errorRatePct * 2 ? 'critical' : 'warning',
            category: 'anomaly',
            title: `Elevated error rate on service "${service}"`,
            description:
              `Recent error rate: ${recentRatePct.toFixed(2)}% ` +
              `(baseline: ${baselineMeanPct.toFixed(2)}%, threshold: ${errorRatePct}%, ` +
              `baseline-source: ${errDecision.usedHourOfDay ? 'hour-of-day' : 'flat'}).`,
            suggested_action:
              'Open the Trace Explorer for this service and inspect failed spans for the root cause.',
            metric_type: 'error_rate',
            detection_method: 'ml-anomaly',
          });
        }
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
