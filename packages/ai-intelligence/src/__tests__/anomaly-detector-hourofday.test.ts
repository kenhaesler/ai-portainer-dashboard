/**
 * Hour-of-day baseline (#1295 fix 3) — metric path.
 *
 * Verifies that `detectAnomaly` and `detectAnomalyAdaptive` consume a
 * hour-of-day baseline when supplied, fall back to the flat rolling-window
 * baseline during warm-up, and produce zero anomalies on a deterministic
 * 14-day diurnal series whose recent observation matches the historical
 * pattern for the current hour.
 *
 * All synthetic series use a seeded Mulberry32 PRNG; seeds are documented
 * in-line so the assertions are reproducible.
 */
import { beforeAll, afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import type { MovingAverageResult } from '@dashboard/contracts';
import { detectAnomaly } from '../services/anomaly-detector.js';
import { detectAnomalyAdaptive } from '../services/adaptive-anomaly-detector.js';
import { mulberry32, gaussianFactory } from '../services/__test-helpers__/mulberry32.js';

// ───────────────────────────────────────────────────────────────────────────
// Synthetic data
// ───────────────────────────────────────────────────────────────────────────

/** Sinusoidal CPU baseline — 20% trough at 03:00 UTC, 80% peak at 15:00 UTC. */
function diurnalCpu(hour: number): number {
  return 50 + 30 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
}

/**
 * Build hour-of-day baseline statistics from a 14-day deterministic series.
 * Returns a closure compatible with `getMovingAverageByHourOfDay`.
 *
 * Seed 0xCAFE — same seed used across all assertions in this file.
 */
function buildHourlyBaseline(noiseStd = 0.1, seed = 0xcafe) {
  const rng = mulberry32(seed);
  const gauss = gaussianFactory(rng);

  // 24 buckets × 14 days = 336 samples.
  const samplesByHour = new Map<number, number[]>();
  for (let d = 0; d < 14; d++) {
    for (let h = 0; h < 24; h++) {
      const v = diurnalCpu(h) + gauss() * noiseStd;
      const list = samplesByHour.get(h) ?? [];
      list.push(v);
      samplesByHour.set(h, list);
    }
  }
  // Pre-compute mean/std per hour so the mock is O(1).
  const statsByHour = new Map<number, MovingAverageResult>();
  for (const [h, vals] of samplesByHour) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    statsByHour.set(h, {
      mean,
      std_dev: Math.sqrt(variance),
      sample_count: vals.length,
    });
  }
  return statsByHour;
}

// ───────────────────────────────────────────────────────────────────────────
// Suite
// ───────────────────────────────────────────────────────────────────────────

describe('detectAnomaly — hour-of-day baseline (#1295 fix 3)', () => {
  const hourly = buildHourlyBaseline(0.1, 0xcafe);

  beforeAll(() => {
    setConfigForTest({
      ANOMALY_ZSCORE_THRESHOLD: 2.5,
      ANOMALY_MOVING_AVERAGE_WINDOW: 30,
      ANOMALY_MIN_SAMPLES: 10,
      ANOMALY_HOUROFDAY_LOOKBACK_DAYS: 14,
      ANOMALY_HOUROFDAY_MIN_SAMPLES: 10,
    });
  });
  afterAll(() => {
    resetConfig();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('14-day diurnal series with σ=0.1: ZERO anomalies on a matching ramp', async () => {
    // The flat baseline mock must NOT be consulted on hours that warm up; we
    // assert this by making it throw.
    const flat = vi.fn(async (): Promise<MovingAverageResult | null> => {
      throw new Error('flat baseline should not be consulted when hourly bucket is dense');
    });
    const hour = vi.fn(async (
      _id: string,
      _metric: string,
      h: number,
    ): Promise<MovingAverageResult | null> => hourly.get(h) ?? null);

    // Walk every UTC hour with the recent value equal to that hour's mean.
    // Use a fixed clock so test determinism is preserved.
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 5, 15, h, 30));
      const recent = diurnalCpu(h); // exact match to baseline mean
      const result = await detectAnomaly('c1', 'web', 'cpu', recent, flat, hour, now);
      expect(result, `hour ${h}`).not.toBeNull();
      expect(result!.is_anomalous, `hour ${h}`).toBe(false);
    }
  });

  it('warm-up fallback: when hourly bucket is sparse, falls back to flat baseline', async () => {
    // Hour 13 has only 2 samples (< minSamples=10); the detector must call the
    // flat baseline mock instead.
    const sparseHourly = vi.fn(async (
      _id: string,
      _metric: string,
      _h: number,
    ): Promise<MovingAverageResult | null> => ({
      mean: 60,
      std_dev: 1,
      sample_count: 2,
    }));
    const flat = vi.fn(async (): Promise<MovingAverageResult | null> => ({
      mean: 50,
      std_dev: 10,
      sample_count: 30,
    }));

    const now = new Date(Date.UTC(2026, 5, 15, 13, 30));
    // 50 + 3.0σ * 10 = 80 → anomalous against the flat baseline.
    const result = await detectAnomaly('c1', 'web', 'cpu', 80, flat, sparseHourly, now);

    expect(result).not.toBeNull();
    expect(result!.is_anomalous).toBe(true);
    expect(result!.mean).toBe(50); // proves the flat baseline was used
    expect(flat).toHaveBeenCalledTimes(1);
  });

  it('detects an anomaly that aligns with the wrong hour-of-day bucket', async () => {
    // Sanity guard: feed the PEAK (200ms equivalent) value at the TROUGH hour
    // and assert that the detector still catches a clear regression. Without
    // hour-of-day awareness this would have been masked by averaging.
    const hour = vi.fn(async (
      _id: string,
      _metric: string,
      h: number,
    ): Promise<MovingAverageResult | null> => hourly.get(h) ?? null);
    const flat = vi.fn(async (): Promise<MovingAverageResult | null> => ({
      mean: 50, std_dev: 5, sample_count: 30,
    }));

    const now = new Date(Date.UTC(2026, 5, 15, 3, 30)); // trough hour
    const result = await detectAnomaly('c1', 'web', 'cpu', diurnalCpu(15), flat, hour, now);
    expect(result).not.toBeNull();
    expect(result!.is_anomalous).toBe(true);
  });
});

describe('detectAnomalyAdaptive — hour-of-day baseline + CV scaling', () => {
  const hourly = buildHourlyBaseline(0.1, 0xcafe);

  beforeAll(() => {
    setConfigForTest({
      ANOMALY_ZSCORE_THRESHOLD: 2.5,
      ANOMALY_MOVING_AVERAGE_WINDOW: 30,
      ANOMALY_MIN_SAMPLES: 10,
      ANOMALY_DETECTION_METHOD: 'adaptive',
      ANOMALY_HOUROFDAY_LOOKBACK_DAYS: 14,
      ANOMALY_HOUROFDAY_MIN_SAMPLES: 10,
      BOLLINGER_BANDS_ENABLED: true,
    });
  });
  afterAll(() => {
    resetConfig();
  });

  it('14-day diurnal series with σ=0.1 — zero anomalies on matching ramp (adaptive)', async () => {
    const flat = vi.fn(async (): Promise<MovingAverageResult | null> => {
      throw new Error('flat baseline should not be consulted when hourly bucket is dense');
    });
    const hour = vi.fn(async (
      _id: string,
      _metric: string,
      h: number,
    ): Promise<MovingAverageResult | null> => hourly.get(h) ?? null);

    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 5, 15, h, 30));
      // The hourly std is ~0.1; recent value = mean → z = 0, not anomalous
      // regardless of which method `selectMethod` picks.
      const result = await detectAnomalyAdaptive(
        'c1', 'web', 'cpu', diurnalCpu(h),
        undefined, flat, hour, now,
      );
      expect(result, `hour ${h}`).not.toBeNull();
      expect(result!.is_anomalous, `hour ${h}`).toBe(false);
    }
  });

  it('warm-up fallback: sparse hourly bucket → flat baseline consulted', async () => {
    const sparseHourly = vi.fn(async (): Promise<MovingAverageResult | null> => ({
      mean: 60, std_dev: 1, sample_count: 2,
    }));
    const flat = vi.fn(async (): Promise<MovingAverageResult | null> => ({
      mean: 50, std_dev: 5, sample_count: 30,
    }));

    const now = new Date(Date.UTC(2026, 5, 15, 13, 30));
    // z = (75 - 50) / 5 = 5.0 — far above any CV-scaled threshold (max 3.75 for high CV).
    const result = await detectAnomalyAdaptive(
      'c1', 'web', 'cpu', 75,
      'zscore', flat, sparseHourly, now,
    );
    expect(result).not.toBeNull();
    expect(result!.is_anomalous).toBe(true);
    expect(result!.mean).toBe(50);
    expect(flat).toHaveBeenCalledTimes(1);
  });
});
