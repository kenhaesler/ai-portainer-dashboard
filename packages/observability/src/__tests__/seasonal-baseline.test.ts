import { describe, it, expect } from 'vitest';
import { poolHourlyBuckets, type HourlyBucket } from '../services/seasonal-baseline.js';

/** Reference: population mean + STDDEV_POP over a flat list of raw samples. */
function popStats(values: number[]) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, std_dev: Math.sqrt(variance), sample_count: n };
}

/** Build a metrics_1hour-style bucket (avg + SAMPLE stddev + count) from raw samples. */
function bucketOf(values: number[]): HourlyBucket {
  const n = values.length;
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const sampleVar = n > 1 ? values.reduce((a, b) => a + (b - avg) ** 2, 0) / (n - 1) : 0;
  return { avg_value: avg, stddev_value: n > 1 ? Math.sqrt(sampleVar) : null, sample_count: n };
}

describe('poolHourlyBuckets — reconstruct AVG/STDDEV_POP from metrics_1hour buckets (#1307)', () => {
  it('exactly matches the population mean + std over the pooled raw samples', () => {
    // Three "days" of the same hour bucket, different within-bucket spread.
    const day1 = [10, 12, 14, 16];
    const day2 = [20, 22, 18];
    const day3 = [11, 13, 15, 17, 19];
    const buckets = [bucketOf(day1), bucketOf(day2), bucketOf(day3)];

    const pooled = poolHourlyBuckets(buckets)!;
    const reference = popStats([...day1, ...day2, ...day3]);

    expect(pooled.sample_count).toBe(reference.sample_count);
    expect(pooled.mean).toBeCloseTo(reference.mean, 9);
    expect(pooled.std_dev).toBeCloseTo(reference.std_dev, 9);
  });

  it('weights the grand mean by each bucket sample_count, not equally', () => {
    // One big bucket near 100, one tiny bucket near 0 — equal-weight mean (~50)
    // would be wrong; count-weighted mean must sit near 100.
    const big = Array.from({ length: 100 }, () => 100);
    const tiny = [0];
    const pooled = poolHourlyBuckets([bucketOf(big), bucketOf(tiny)])!;
    expect(pooled.mean).toBeCloseTo((100 * 100 + 0) / 101, 9);
    expect(pooled.sample_count).toBe(101);
  });

  it('handles single-sample buckets (null stddev) without NaN', () => {
    const pooled = poolHourlyBuckets([
      { avg_value: 5, stddev_value: null, sample_count: 1 },
      { avg_value: 9, stddev_value: null, sample_count: 1 },
    ])!;
    // Two points {5, 9}: mean 7, pop std 2.
    expect(pooled.mean).toBeCloseTo(7, 9);
    expect(pooled.std_dev).toBeCloseTo(2, 9);
    expect(pooled.sample_count).toBe(2);
  });

  it('returns null for no buckets or all-empty buckets', () => {
    expect(poolHourlyBuckets([])).toBeNull();
    expect(poolHourlyBuckets([{ avg_value: 0, stddev_value: null, sample_count: 0 }])).toBeNull();
  });
});
