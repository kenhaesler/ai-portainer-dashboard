/**
 * Tests for issue #1295 — trace anomaly detector:
 *   • Fix 2: CV-based variance scaling (low / medium / high regimes).
 *   • Fix 3: hour-of-day baseline (diurnal series → zero false positives).
 *   • Warm-up fallback to the flat baseline when the hour bucket is sparse.
 *
 * All synthetic series are driven by a seeded Mulberry32 PRNG; seeds are
 * documented in-line so the assertions are reproducible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub getConfig() before the SUT imports it — test env doesn't satisfy the
// full production env schema (JWT_SECRET, DASHBOARD_USERNAME, etc.).
vi.mock('@dashboard/core/config/index.js', () => ({
  getConfig: () => ({
    TRACES_ANOMALY_P95_ZSCORE: 2.5,
    TRACES_ANOMALY_ERROR_RATE_PCT: 100, // Disable error-rate signal here — we focus on latency.
    ANOMALY_HOUROFDAY_LOOKBACK_DAYS: 14,
    ANOMALY_HOUROFDAY_MIN_SAMPLES: 3,
  }),
}));

import {
  runTraceAnomalyCycle,
  pickBaselineSeries,
  __resetTraceAnomalyLogState,
  type RedBucket,
  type RedResult,
  type RedRow,
} from './trace-anomaly.js';
import * as insightsStore from './insights-store.js';
import { mulberry32, gaussianFactory } from './__test-helpers__/mulberry32.js';
import { classifyCv, cvThresholdMultiplier } from './anomaly-stats.js';

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function row(group: string, p95: number, errorRate = 0): RedRow {
  return {
    group,
    rate: 10,
    errorRate,
    p50Ms: p95 * 0.5,
    p95Ms: p95,
    p99Ms: p95 * 1.1,
    callCount: 100,
  };
}

/** Sinusoidal diurnal mean — minimum 50ms at 03:00 UTC, maximum 200ms at 15:00 UTC. */
function diurnalMean(hour: number): number {
  return 125 + 75 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
}

/**
 * Build a deterministic baseline spanning `days` days × 24 hourly buckets,
 * with a single service ("api") whose p95 follows `diurnalMean(hour)` plus
 * Gaussian noise of standard deviation `noiseStd`.
 *
 * Bucket timestamps are spread across `days` calendar days so the `getUTCHours`
 * key matches across days — exactly mimicking what `computeRed` returns over
 * a multi-day lookback.
 *
 * @param seed - documented in tests
 */
function buildDiurnalBaseline(days: number, seed: number, noiseStd: number): RedResult {
  const rng = mulberry32(seed);
  const gauss = gaussianFactory(rng);
  const buckets: RedBucket[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const p95 = Math.max(1, diurnalMean(h) + gauss() * noiseStd);
      buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 1 + d, h)).toISOString(),
        rows: [row('api', p95)],
      });
    }
  }
  return { buckets, truncated: false };
}

/**
 * Recent (1m bucket) result whose trailing bucket is at `hour`.
 * The detector only inspects the trailing bucket, so we only need that to be
 * representative.
 */
function buildRecentAtHour(hour: number, p95: number): RedResult {
  const buckets: RedBucket[] = [];
  // Synthesize a short tail so the detector's "last bucket wins" picks `hour`.
  for (let i = 0; i < 3; i++) {
    buckets.push({
      bucketStart: new Date(Date.UTC(2026, 5, 15, hour, i * 20)).toISOString(),
      rows: [row('api', p95)],
    });
  }
  return { buckets, truncated: false };
}

// ───────────────────────────────────────────────────────────────────────────
// Suite
// ───────────────────────────────────────────────────────────────────────────

describe('trace-anomaly — CV variance scaling (#1295 fix 2)', () => {
  beforeEach(() => {
    __resetTraceAnomalyLogState();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('helper: classifyCv maps low/medium/high boundaries per the issue spec', () => {
    // Spec: Low CV < 0.1 → 1.0×; Medium 0.1–0.3 → 1.2×; High ≥ 0.3 → 1.5×.
    expect(classifyCv(100, 5)).toBe('low');          // cv = 0.05
    expect(classifyCv(100, 15)).toBe('medium');      // cv = 0.15
    expect(classifyCv(100, 30)).toBe('high');        // cv = 0.30
    expect(classifyCv(100, 50)).toBe('high');        // cv = 0.50

    // Boundary edge: cv exactly 0.1 falls into medium.
    expect(classifyCv(100, 10)).toBe('medium');

    expect(cvThresholdMultiplier('low')).toBe(1.0);
    expect(cvThresholdMultiplier('medium')).toBe(1.2);
    expect(cvThresholdMultiplier('high')).toBe(1.5);
  });

  it('low-CV (stable baseline): a 3.0σ spike trips the unmodified threshold', async () => {
    // Seed 0xC0FFEE-low — low-CV baseline at mean ≈ 100ms, noise σ ≈ 3ms (cv ≈ 0.03).
    const rng = mulberry32(0xc0ffee);
    const gauss = gaussianFactory(rng);
    const buckets: RedBucket[] = [];
    for (let i = 0; i < 24; i++) {
      const p95 = 100 + gauss() * 3;
      buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, i)).toISOString(),
        rows: [row('api', p95)],
      });
    }
    const baseline: RedResult = { buckets, truncated: false };
    // Spike well above 2.5σ but the multiplier is 1.0× for low CV — anomaly fires.
    const recent = buildRecentAtHour(/* hour */ 13, /* p95 */ 130);

    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) =>
      q.bucket === '1h' ? baseline : recent,
    );
    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    const latency = inserted.filter((r) => r.metric_type === 'latency_p95');
    expect(latency.length).toBe(1);
    expect(latency[0].description.toLowerCase()).toContain('cv-regime: low');
  });

  it('high-CV (naturally noisy baseline): a 3.0σ spike no longer trips the detector', async () => {
    // Seed 0xC0FFEE-high — mean ≈ 100ms, noise σ ≈ 35ms → cv ≈ 0.35 (high regime).
    // Effective threshold: 2.5 × 1.5 = 3.75σ. We craft a spike at ≈ 3.0σ which
    // would have tripped the old (flat-multiplier) detector but must NOT trip
    // the CV-scaled one.
    const rng = mulberry32(0xc0ffee + 1);
    const gauss = gaussianFactory(rng);
    const buckets: RedBucket[] = [];
    const noise: number[] = [];
    for (let i = 0; i < 24; i++) {
      const n = gauss() * 35;
      noise.push(n);
      buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, i)).toISOString(),
        rows: [row('api', Math.max(1, 100 + n))],
      });
    }
    const baseline: RedResult = { buckets, truncated: false };

    // Compute the baseline mean+std the detector will see (population stddev).
    const samples = buckets.map((b) => b.rows[0].p95Ms);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, v) => a + (v - mean) ** 2, 0) / samples.length;
    const std = Math.sqrt(variance);
    // Aim for a spike at ~3.0σ — well above the base threshold (2.5) but
    // comfortably below the high-CV scaled threshold (3.75).
    const spike = mean + 3.0 * std;

    const recent = buildRecentAtHour(13, spike);

    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) =>
      q.bucket === '1h' ? baseline : recent,
    );
    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    const latency = inserted.filter((r) => r.metric_type === 'latency_p95');
    expect(latency).toHaveLength(0);
  });

  it('medium-CV: a 3.0σ spike trips the base threshold but a 1.5σ spike does not', async () => {
    // Seed 0xC0FFEE-med — mean ≈ 100ms, noise σ ≈ 20ms → cv ≈ 0.20 (medium).
    // Effective threshold: 2.5 × 1.2 = 3.0σ.
    const rng = mulberry32(0xc0ffee + 2);
    const gauss = gaussianFactory(rng);
    const buckets: RedBucket[] = [];
    for (let i = 0; i < 24; i++) {
      const p95 = 100 + gauss() * 20;
      buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, i)).toISOString(),
        rows: [row('api', Math.max(1, p95))],
      });
    }
    const baseline: RedResult = { buckets, truncated: false };

    const samples = buckets.map((b) => b.rows[0].p95Ms);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, v) => a + (v - mean) ** 2, 0) / samples.length;
    const std = Math.sqrt(variance);

    // Below 3.0σ — must NOT trip.
    {
      const recent = buildRecentAtHour(13, mean + 2.0 * std);
      const inserted: insightsStore.InsightInsert[] = [];
      const spy = vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
        inserted.push(...rows);
        return new Set(rows.map((r) => r.id));
      });
      const computeRed = vi.fn(async (q: { bucket: string }) =>
        q.bucket === '1h' ? baseline : recent,
      );
      await runTraceAnomalyCycle({ computeRed: computeRed as never });
      expect(inserted.filter((r) => r.metric_type === 'latency_p95')).toHaveLength(0);
      spy.mockRestore();
      __resetTraceAnomalyLogState();
    }

    // Comfortably above 3.0σ — MUST trip.
    {
      const recent = buildRecentAtHour(13, mean + 4.0 * std);
      const inserted: insightsStore.InsightInsert[] = [];
      vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
        inserted.push(...rows);
        return new Set(rows.map((r) => r.id));
      });
      const computeRed = vi.fn(async (q: { bucket: string }) =>
        q.bucket === '1h' ? baseline : recent,
      );
      await runTraceAnomalyCycle({ computeRed: computeRed as never });
      const latency = inserted.filter((r) => r.metric_type === 'latency_p95');
      expect(latency.length).toBeGreaterThanOrEqual(1);
      expect(latency[0].description.toLowerCase()).toContain('cv-regime: medium');
    }
  });
});

describe('trace-anomaly — hour-of-day baseline (#1295 fix 3)', () => {
  beforeEach(() => {
    __resetTraceAnomalyLogState();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('helper: pickBaselineSeries falls back to flat baseline below min-samples', () => {
    const hourly = new Map<string, Map<number, number[]>>([
      ['api', new Map<number, number[]>([[13, [50, 55, 60]]])], // 3 samples
    ]);
    const flat = new Map<string, number[]>([['api', [10, 20, 30, 40]]]);

    // Hour with insufficient samples → fall back to flat.
    const sparse = pickBaselineSeries({ hourly, flat, service: 'api', hour: 14, minHourSamples: 3 });
    expect(sparse.usedHourOfDay).toBe(false);
    expect(sparse.series).toEqual([10, 20, 30, 40]);

    // Hour with enough samples → use hour-of-day.
    const dense = pickBaselineSeries({ hourly, flat, service: 'api', hour: 13, minHourSamples: 3 });
    expect(dense.usedHourOfDay).toBe(true);
    expect(dense.series).toEqual([50, 55, 60]);

    // Boundary: minHourSamples = 4 (one more than we have) → fall back.
    const boundary = pickBaselineSeries({ hourly, flat, service: 'api', hour: 13, minHourSamples: 4 });
    expect(boundary.usedHourOfDay).toBe(false);
  });

  it('14-day diurnal series with σ=0.1 fires ZERO anomalies on a matching ramp', async () => {
    // Seed 0xD1A1 — 14 days × 24 hours = 336 samples per service, with a clean
    // sinusoidal mean and σ=0.1 noise. Per AC: zero anomalies must fire when
    // the recent observation matches the historical pattern.
    const baseline = buildDiurnalBaseline(/* days */ 14, /* seed */ 0xd1a1, /* noiseStd */ 0.1);

    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    // Sweep all 24 hours so we exercise both the morning ramp (high mean) and
    // the trough (low mean). Each hour MUST not flag.
    for (let hour = 0; hour < 24; hour++) {
      __resetTraceAnomalyLogState();
      const recent = buildRecentAtHour(hour, diurnalMean(hour)); // exact mean → 0σ
      const computeRed = vi.fn(async (q: { bucket: string }) =>
        q.bucket === '1h' ? baseline : recent,
      );
      await runTraceAnomalyCycle({ computeRed: computeRed as never });
    }

    expect(inserted.filter((r) => r.metric_type === 'latency_p95')).toHaveLength(0);
  });

  it('would have flagged the morning ramp WITHOUT hour-of-day awareness', async () => {
    // Sanity guard: prove the test above is meaningful. Same diurnal baseline,
    // but supply a single-hour baseline (only hour 3, the trough) so the
    // detector flat-pools low-mean samples. A 200ms recent at hour 15 will
    // look anomalous against that flat low-mean baseline.
    const flatLow = buildDiurnalBaseline(1, 0xd1a1, 0.1);
    // Replace all buckets with the hour-3 (trough) value at a single hour.
    const troughOnly: RedResult = {
      buckets: flatLow.buckets.map((b, i) => ({
        ...b,
        bucketStart: new Date(Date.UTC(2026, 4, 1, i)).toISOString(),
        rows: [row('api', diurnalMean(3))],
      })),
      truncated: false,
    };
    const recent = buildRecentAtHour(/* peak hour */ 15, diurnalMean(15));

    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) =>
      q.bucket === '1h' ? troughOnly : recent,
    );
    __resetTraceAnomalyLogState();
    await runTraceAnomalyCycle({ computeRed: computeRed as never });
    expect(inserted.filter((r) => r.metric_type === 'latency_p95').length).toBeGreaterThan(0);
  });

  it('warm-up fallback: when the hour bucket is sparse, uses the flat baseline', async () => {
    // Only the FIRST day populates hour 13; all other buckets are at hour 4.
    // hour-13 bucket therefore has 1 sample < minHourSamples (3) → falls back
    // to the flat (24-sample) baseline. Recent at hour 13 with a spike must
    // be evaluated against the flat baseline rather than the (sparse) hour
    // bucket, and the description should advertise the `baseline: flat` path.
    const buckets: RedBucket[] = [];
    for (let i = 0; i < 24; i++) {
      buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 1, 4)).toISOString(), // always hour 4
        rows: [row('api', 100)],
      });
    }
    // Single hour-13 sample, also p95=100. This is the lone hour-of-day data
    // point; below minHourSamples=3 → fall-back.
    buckets.push({
      bucketStart: new Date(Date.UTC(2026, 4, 1, 13)).toISOString(),
      rows: [row('api', 100)],
    });
    const baseline: RedResult = { buckets, truncated: false };

    // Spike well above the flat baseline (mean=100, std=0). The std=0 branch
    // in the detector uses a relative-deviation rule with min 50ms tolerance.
    const recent = buildRecentAtHour(13, 250);

    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) =>
      q.bucket === '1h' ? baseline : recent,
    );
    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    const latency = inserted.filter((r) => r.metric_type === 'latency_p95');
    expect(latency.length).toBeGreaterThanOrEqual(1);
    // Warm-up fallback must be visible in the description for operator clarity.
    expect(latency[0].description.toLowerCase()).toContain('baseline: flat');
  });
});
