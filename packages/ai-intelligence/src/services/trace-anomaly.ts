import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '@dashboard/core/config/index.js';
import { getCooldownStore } from '@dashboard/core/services/cooldown-store.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { AnomalyDimension } from '@dashboard/core/models/monitoring.js';
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

// Suppress duplicate anomaly inserts when the underlying problem is
// persistent. 10 minutes mirrors the cooldown the existing metric anomaly
// detector uses for ongoing conditions.
//
// Cooldown key semantics (#1296):
//   • Single-dimension record  → `<metric_type>:<service>` (e.g.
//     `latency_p95:api`). One cooldown per (service, dimension) — a service
//     with persistent latency does NOT block a fresh error-rate alert.
//   • Correlated (multi-dim) record → `correlated:<service>:<minuteEpoch>`
//     AND, on insert, the per-dimension keys above are also marked so a
//     second cycle in the same 10-minute window cannot fire either an
//     individual or a re-correlated alert. The minute bucket is part of
//     the key so the next minute's correlation can still flag a NEW
//     incident if the cooldown has elapsed.
// Cooldown + per-service rate-limit state is held in the shared cooldown store
// (#1361 fix 4) so it survives restarts and is shared across replicas. The
// per-service rate limit (#1294, fix 7) keeps a single noisy service from
// emitting two anomalies (latency_p95 *and* error_rate) back to back; it uses a
// distinct `svc:` key namespace so it never collides with the per-dimension
// cooldown keys.
const COOLDOWN_MS = 10 * 60 * 1000;
const serviceKey = (service: string): string => `svc:${service}`;

/** Test hook: clear log throttle and (in-memory) cooldown state between tests. */
export function __resetTraceAnomalyLogState(): void {
  lastLoggedAt.clear();
  void getCooldownStore().reset();
}

function shouldLog(seriesKey: string): boolean {
  const now = Date.now();
  const last = lastLoggedAt.get(seriesKey) ?? 0;
  if (now - last < LOG_THROTTLE_MS) return false;
  lastLoggedAt.set(seriesKey, now);
  return true;
}

async function inCooldown(seriesKey: string): Promise<boolean> {
  return getCooldownStore().isHot(seriesKey, COOLDOWN_MS);
}

async function inServiceRateLimit(service: string, windowMs: number): Promise<boolean> {
  if (windowMs <= 0) return false;
  return getCooldownStore().isHot(serviceKey(service), windowMs);
}

async function markInserted(seriesKey: string, service: string): Promise<void> {
  const store = getCooldownStore();
  await store.mark(seriesKey);
  await store.mark(serviceKey(service));
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

function latestBucketOfRecent(
  recent: RedResult,
): { hour: number; rows: RedRow[]; bucketStart: string } | null {
  // Buckets come back ordered by bucket_start ASC; the trailing bucket is the
  // most recent 1-minute observation. We deliberately inspect ONLY that
  // trailing bucket — older buckets in the 1h recent window are intentionally
  // skipped to bias toward fresh data and to give us a single, well-defined
  // hour-of-day key for the baseline lookup.
  //
  // Behavioural shift from the pre-#1302 detector: the previous
  // `latestRowPerGroup` scanned every recent bucket and kept the
  // last-occurrence row per service, so a service that emitted traffic 20
  // minutes ago but is now silent would still be evaluated. That fallback is
  // gone — silent services in the trailing minute are simply not evaluated
  // this cycle, which is acceptable because:
  //   1. The cycle re-runs frequently, so a transient gap just defers the
  //      check by a minute or two rather than dropping the anomaly.
  //   2. The hour-of-day baseline now needs a single observation hour to look
  //      up, not a smear across 60 minutes.
  //
  // Correlated suppression note (#1296): the `bucketStart` we return here
  // becomes the `minuteKey` for ALL candidates emitted this cycle, so two
  // dimensions (latency + error-rate) that fire on the same trailing minute
  // collapse into a single correlated insight. Because `latestBucketOfRecent`
  // already restricts evaluation to one bucket, correlated suppression
  // operates strictly within that trailing minute — which matches the spec's
  // "same minute" requirement.
  const last = recent.buckets[recent.buckets.length - 1];
  if (!last) return null;
  const hour = new Date(last.bucketStart).getUTCHours();
  if (Number.isNaN(hour)) return null;
  return { hour, rows: last.rows, bucketStart: last.bucketStart };
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
 * Truncate an ISO timestamp to the minute boundary (UTC). Used as the
 * correlation key so two signals that fire from the same minute-bucket get
 * collapsed into a single insight.
 */
function minuteEpoch(bucketStart: string): number {
  return Math.floor(new Date(bucketStart).getTime() / 60_000);
}

/**
 * Candidate anomaly emitted by the detection pass before correlated
 * suppression collapses same-minute signals into a single insight.
 *
 * Severity lives ONLY on `dimension.severity` (single source of truth); the
 * outer severity used to persist the record is derived from it at insert time
 * — see `pushCandidate` / the correlated path below.
 */
interface AnomalyCandidate {
  service: string;
  minuteKey: number;
  dimension: AnomalyDimension;
  /** Per-dimension human-readable title for single-dim insights. */
  title: string;
  /** Per-dimension human-readable description for single-dim insights. */
  description: string;
  /** Per-dimension suggested operator action for single-dim insights. */
  suggestedAction: string;
}

/**
 * Normalised "how anomalous is this" score in threshold units. A value of
 * 1.0 means the signal just crossed threshold; 2.0 means twice the threshold;
 * etc. Used by correlated-suppression tie-breaking so latency (z-score in
 * std-deviation units) and error-rate (deviation in error-rate-pct units)
 * compare on the same scale (#1306 review).
 */
function normalisedSignalScore(
  dim: AnomalyDimension,
  zThreshold: number,
): number {
  if (dim.type === 'latency_p95') {
    return zThreshold > 0 ? Math.abs(dim.zScore) / zThreshold : Math.abs(dim.zScore);
  }
  // For `error_rate`, `zScore` is already
  //   (recentRatePct - baselineMeanPct) / errorRatePct
  // i.e. already expressed in threshold units, so use it directly.
  return Math.abs(dim.zScore);
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

  // ─── Phase 1: detection ──────────────────────────────────────────────
  // Build a list of (service, dimension) candidates BEFORE deciding what to
  // persist. Correlated suppression (#1296) needs to see both dimensions at
  // once so it can collapse same-minute pairs into a single insight.
  const candidatesByService = new Map<string, AnomalyCandidate[]>();

  function pushCandidate(c: AnomalyCandidate): void {
    const arr = candidatesByService.get(c.service);
    if (arr) arr.push(c);
    else candidatesByService.set(c.service, [c]);
  }

  // All candidates emitted this cycle share the trailing-bucket minute key:
  // `latestBucketOfRecent` restricts us to a single 1m bucket, so the
  // correlated-suppression scope is "same minute" by construction (#1296).
  const mKey = minuteEpoch(latest.bucketStart);

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
      // relative deviation rule instead — flag if recent is > 2x baseline
      // mean and at least 50ms above it (avoids tiny-value noise).
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
        // Severity threshold uses the CV-scaled `scaledZThreshold` (#1295)
        // so critical/warning splits move in lock-step with the gating
        // threshold above.
        const severity: 'critical' | 'warning' =
          zScore > scaledZThreshold * 2 ? 'critical' : 'warning';
        pushCandidate({
          service,
          minuteKey: mKey,
          dimension: {
            type: 'latency_p95',
            value: row.p95Ms,
            baseline: mean,
            zScore,
            severity,
          },
          title: `High latency p95 on service "${service}"`,
          description:
            `Recent p95: ${row.p95Ms.toFixed(1)}ms ` +
            `(baseline mean: ${mean.toFixed(1)}ms, std: ${std.toFixed(1)}ms, ` +
            `z-score: ${zScore.toFixed(2)}, threshold: ${scaledZThreshold.toFixed(2)}, ` +
            `cv-regime: ${regime}, baseline: ${p95Decision.usedHourOfDay ? 'hour-of-day' : 'flat'}). ` +
            `Latency is ${Math.abs(zScore).toFixed(1)} standard deviations above the baseline.`,
          suggestedAction:
            'Inspect the Calls tab for the affected service to identify slow endpoints, and check downstream dependencies.',
        });
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
      // Compare against the baseline mean as well — only flag if it's
      // clearly worse than what the service usually emits.
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
        const severity: 'critical' | 'warning' =
          recentRatePct >= errorRatePct * 2 ? 'critical' : 'warning';
        // Z-score-like deviation in percentage-point units, normalised by
        // the floor threshold. Lets multi-dim records carry a comparable
        // "how bad" number per dimension without needing a real std.
        const deviationZ = Math.max(0, (recentRatePct - baselineMeanPct) / errorRatePct);
        pushCandidate({
          service,
          minuteKey: mKey,
          dimension: {
            type: 'error_rate',
            value: row.errorRate,
            baseline: baselineMeanPct / 100,
            zScore: deviationZ,
            severity,
          },
          title: `Elevated error rate on service "${service}"`,
          description:
            `Recent error rate: ${recentRatePct.toFixed(2)}% ` +
            `(baseline: ${baselineMeanPct.toFixed(2)}%, threshold: ${errorRatePct}%, ` +
            `baseline-source: ${errDecision.usedHourOfDay ? 'hour-of-day' : 'flat'}).`,
          suggestedAction:
            'Open the Trace Explorer for this service and inspect failed spans for the root cause.',
        });
      }
    }
  }

  // ─── Phase 2: correlated suppression + cooldown gating ───────────────
  // When two candidates share the same (service, minute) bucket, collapse
  // them into a single insight whose `dimensions` array carries both
  // signals. Single-dimension candidates flow through unchanged.
  const insights: InsightInsert[] = [];

  for (const [service, candidates] of candidatesByService) {
    if (candidates.length === 0) continue;

    // Bucket candidates by minute. In practice the recent query uses 1m
    // buckets and `latestRowPerGroup` keeps the most-recent row only, so
    // every candidate for a given service shares the same minute key — but
    // the grouping is defensive in case that ever changes.
    const byMinute = new Map<number, AnomalyCandidate[]>();
    for (const c of candidates) {
      const arr = byMinute.get(c.minuteKey);
      if (arr) arr.push(c);
      else byMinute.set(c.minuteKey, [c]);
    }

    for (const [minuteKey, group] of byMinute) {
      // Per-service rate limit (#1294, fix 7): regardless of how many
      // dimensions fire, a single service must not emit more than one
      // anomaly inside the configured window. Layered on top of the
      // per-(service, metric_type) cooldown below; the correlated path
      // additionally relies on this to prevent rapid back-to-back inserts
      // when multiple minute-keys queue up for the same service.
      if (await inServiceRateLimit(service, perServiceWindowMs)) continue;

      if (group.length === 1) {
        // ── Single-dimension path (unchanged behaviour) ───────────────
        const [c] = group;
        const dimKey = `${c.dimension.type}:${service}`;
        if ((await inCooldown(dimKey)) || (await inCooldown(`correlated:${service}:${minuteKey}`))) continue;
        await markInserted(dimKey, service);
        insights.push({
          id: uuidv4(),
          endpoint_id: null,
          endpoint_name: null,
          container_id: null,
          // Project the service name into container_name so existing
          // dashboard correlation that groups insights by container
          // surfaces these anomalies alongside metric-driven ones (#1236).
          container_name: service,
          // Severity is sourced from the dimension — single source of truth.
          severity: c.dimension.severity,
          category: 'anomaly',
          title: c.title,
          description: c.description,
          suggested_action: c.suggestedAction,
          metric_type: c.dimension.type,
          detection_method: 'ml-anomaly',
        });
        continue;
      }

      // ── Correlated path (#1296) ─────────────────────────────────────
      // Cooldown: skip if EITHER the per-minute correlated key OR any of
      // the per-dimension keys is hot — a recent single-dim insert for
      // the same service shouldn't be immediately followed by a
      // correlated one in the next cycle.
      const correlatedKey = `correlated:${service}:${minuteKey}`;
      if (await inCooldown(correlatedKey)) continue;
      let anyDimHot = false;
      for (const c of group) {
        if (await inCooldown(`${c.dimension.type}:${service}`)) {
          anyDimHot = true;
          break;
        }
      }
      if (anyDimHot) continue;

      // Pick the more severe dimension as the "primary" — its metric_type
      // drives signature derivation and the title carries both signals.
      //
      // Tie-breaker (#1306 review): when both candidates share the same
      // severity bucket we compare them on a NORMALISED scale (each signal's
      // anomaly score divided by its own threshold). Without normalisation,
      // latency_p95 carries a real std-dev z-score while error_rate carries
      // a deviation-in-percentage-points/threshold ratio, so a raw
      // `Math.abs(zScore)` comparison mixed apples and oranges. Normalising
      // to "threshold units" makes the comparison meaningful.
      const sortedBySeverity = [...group].sort((a, b) => {
        if (a.dimension.severity !== b.dimension.severity) {
          return a.dimension.severity === 'critical' ? -1 : 1;
        }
        return (
          normalisedSignalScore(b.dimension, zThreshold) -
          normalisedSignalScore(a.dimension, zThreshold)
        );
      });
      const primary = sortedBySeverity[0];
      const overallSeverity: 'critical' | 'warning' = sortedBySeverity.some(
        (c) => c.dimension.severity === 'critical',
      )
        ? 'critical'
        : 'warning';

      const dimensions = group.map((c) => c.dimension);
      const dimensionsLabel = group
        .map((c) => c.dimension.type)
        .sort()
        .join(' + ');
      const combinedDescription = group.map((c) => c.description).join(' ');

      // The correlated insert also bumps the per-service rate-limit clock
      // via `markInserted(key, service)` — any subsequent single-dim or
      // correlated firing on the same service is suppressed until the
      // window elapses.
      await markInserted(correlatedKey, service);
      // Also mark per-dimension keys so any out-of-band single-dim
      // detection later in the cooldown window is suppressed.
      for (const c of group) await markInserted(`${c.dimension.type}:${service}`, service);

      insights.push({
        id: uuidv4(),
        endpoint_id: null,
        endpoint_name: null,
        container_id: null,
        container_name: service,
        severity: overallSeverity,
        category: 'anomaly',
        title: `Correlated anomaly on service "${service}" (${dimensionsLabel})`,
        description: combinedDescription,
        suggested_action: primary.suggestedAction,
        metric_type: primary.dimension.type,
        detection_method: 'ml-anomaly',
        dimensions,
      });
    }
  }

  if (insights.length === 0) return;
  try {
    await insightsStore.insertInsights(insights);
  } catch (err) {
    log.warn({ err, count: insights.length }, 'failed to insert trace anomalies');
  }
}
