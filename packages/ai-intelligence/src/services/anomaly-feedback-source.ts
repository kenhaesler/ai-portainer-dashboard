/**
 * Production feedback source (#1364). Binds the pure labelled-store logic
 * (`anomaly-labels.ts`) to the real `anomaly_feedback` table (migration 037,
 * #1298) so the auto-tune job can measure a true per-detector false-positive
 * rate from operator dispositions.
 *
 * The SQL is a thin read; the aggregation (votes → ground truth → FP rate) stays
 * in the pure, unit-tested labelled store. A fake `AppDb` exercises this module
 * without a database.
 */

import {
  getAnomalyLabels,
  measuredFpRate,
  type FeedbackRow,
  type FetchFeedbackFn,
} from './anomaly-labels.js';

/** The slice of `AppDb` this module needs (avoids importing the concrete type). */
export interface FeedbackDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface FeedbackSourceOptions {
  /** Only consider feedback from the last N days (default 30). */
  lookbackDays?: number;
}

/**
 * Build a `FetchFeedbackFn` over the `anomaly_feedback` table. Bounded to a
 * lookback window so the measured rate tracks recent detector behaviour rather
 * than ancient feedback; optionally filtered to one detector.
 */
export function createFeedbackFetcher(
  db: FeedbackDb,
  opts: FeedbackSourceOptions = {},
): FetchFeedbackFn {
  const lookbackDays = opts.lookbackDays ?? 30;
  return async ({ detector } = {}) => {
    // `(? IS NULL OR detector = ?)` — the same value is bound twice so the
    // detector filter is a no-op when none is supplied. `make_interval` keeps
    // the lookback window parameterised (no string-built intervals).
    return db.query<FeedbackRow>(
      `SELECT anomaly_id, disposition, detector
         FROM anomaly_feedback
        WHERE created_at > NOW() - make_interval(days => ?)
          AND (? IS NULL OR detector = ?)`,
      [lookbackDays, detector ?? null, detector ?? null],
    );
  };
}

/**
 * Measure the per-detector false-positive rate and the number of conclusively
 * labelled anomalies it is based on — the exact `{rate, sampleCount}` shape the
 * auto-tune orchestrator consumes.
 */
export async function measureFpRateFromDb(
  db: FeedbackDb,
  detector: string,
  opts: FeedbackSourceOptions = {},
): Promise<{ rate: number; sampleCount: number }> {
  const fetch = createFeedbackFetcher(db, opts);
  const labels = await getAnomalyLabels(fetch, { detector });
  let sampleCount = 0;
  for (const gt of labels.values()) {
    if (gt.label !== null) sampleCount++;
  }
  return { rate: measuredFpRate(labels), sampleCount };
}
