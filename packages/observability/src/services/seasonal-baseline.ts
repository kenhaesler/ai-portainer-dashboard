/**
 * Pure seasonal-baseline math (#1307). Lets the hour-of-day / day-of-week
 * baseline read TimescaleDB's `metrics_1hour` continuous aggregate instead of
 * scanning the raw `metrics` hypertable: a handful of pre-computed hourly buckets
 * replace ~millions of raw rows per lookup.
 *
 * `poolHourlyBuckets` reconstructs the EXACT population mean + `STDDEV_POP` over
 * all underlying raw samples from the per-bucket `avg_value` / `stddev_value`
 * (sample stddev, as Postgres `STDDEV` emits) / `sample_count`, via the law of
 * total variance — so swapping the data source is statistically equivalent to the
 * old raw query, just far cheaper.
 *
 * Kept dependency-free and DB-agnostic so it is unit-tested against known raw
 * data with no database.
 */

export interface HourlyBucket {
  avg_value: number;
  /** Per-bucket SAMPLE stddev (Postgres `STDDEV`/`STDDEV_SAMP`); null for single-sample buckets. */
  stddev_value: number | null;
  sample_count: number;
}

export interface PooledStats {
  mean: number;
  /** Population stddev of the underlying raw samples (matches `STDDEV_POP`). */
  std_dev: number;
  sample_count: number;
}

/**
 * Pool per-hour buckets back into the population mean + stddev of the raw
 * samples they summarise. Returns null when the buckets contain no samples.
 */
export function poolHourlyBuckets(buckets: readonly HourlyBucket[]): PooledStats | null {
  let n = 0;
  for (const b of buckets) n += b.sample_count;
  if (n === 0) return null;

  // Count-weighted grand mean.
  let weightedSum = 0;
  for (const b of buckets) weightedSum += b.avg_value * b.sample_count;
  const mean = weightedSum / n;

  // Total sum of squares = within-bucket SS + between-bucket SS.
  //   within_i  = (c_i - 1) · s_i²   (s_i = sample stddev; 0 for single-sample buckets)
  //   between_i = c_i · (mean_i - grandMean)²
  let ss = 0;
  for (const b of buckets) {
    if (b.sample_count > 1 && b.stddev_value != null) {
      ss += b.stddev_value * b.stddev_value * (b.sample_count - 1);
    }
    ss += b.sample_count * (b.avg_value - mean) ** 2;
  }

  return { mean, std_dev: Math.sqrt(ss / n), sample_count: n };
}
