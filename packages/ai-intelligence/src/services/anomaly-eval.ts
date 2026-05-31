/**
 * Anomaly-detector evaluation metrics (#1364).
 *
 * The detector has never been measured quantitatively — the #1294 audit had to
 * proxy the false-positive rate, and accuracy is meaningless at this class
 * imbalance. These are the rigorous metrics the eval rig reports: point-wise
 * precision/recall/F1 at a threshold, and PR-AUC (average precision) — the
 * threshold-independent summary that is the right headline for rare-event
 * detection (not ROC-AUC, which is optimistic under heavy imbalance).
 */
import { meanAndStd, medianAndMad, modifiedZScore } from './anomaly-stats.js';

export interface PrecisionRecallF1 {
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Precision/recall/F1 for a single score threshold: an item is predicted
 * anomalous when `score >= threshold`. Precision is 1 (vacuously) when nothing
 * is predicted positive; recall is 1 when there are no actual positives.
 */
export function precisionRecallF1(
  scores: readonly number[],
  labels: readonly boolean[],
  threshold: number,
): PrecisionRecallF1 {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const predicted = scores[i] >= threshold;
    if (predicted && labels[i]) tp++;
    else if (predicted && !labels[i]) fp++;
    else if (!predicted && labels[i]) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

/**
 * PR-AUC as average precision: sort by score descending and sum
 * `precision · Δrecall` at each step (step interpolation). Threshold-independent
 * and robust to class imbalance. Returns 0 when there are no positives.
 */
export function prAuc(scores: readonly number[], labels: readonly boolean[]): number {
  const totalPositives = labels.reduce((acc, l) => acc + (l ? 1 : 0), 0);
  if (totalPositives === 0) return 0;

  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);

  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let ap = 0;
  for (const i of order) {
    if (labels[i]) tp++;
    else fp++;
    const precision = tp / (tp + fp);
    const recall = tp / totalPositives;
    ap += precision * (recall - prevRecall);
    prevRecall = recall;
  }
  return ap;
}

/**
 * Score each point of a series with the production ROBUST detector (#1362):
 * one-sided modified z-score (median + MAD) over a trailing window that excludes
 * the point under test. Drops score 0 (one-sided). The first `windowSize` points
 * are warm-up (`null`). Used to replay labelled series through the eval rig.
 */
export function scoreSeriesRobust(
  values: readonly number[],
  windowSize: number,
): Array<number | null> {
  const scores: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    if (i < windowSize) {
      scores.push(null);
      continue;
    }
    const window = values.slice(i - windowSize, i);
    const { median, mad } = medianAndMad(window);
    if (mad === 0) {
      const tol = Math.max(Math.abs(median) * 0.1, 0.01);
      scores.push(Math.max(0, (values[i] - median) / tol));
    } else {
      scores.push(Math.max(0, modifiedZScore(values[i], median, mad)));
    }
  }
  return scores;
}

/**
 * Score each point with the ROBUST detector against a SEASONAL same-phase
 * baseline (#1307): instead of the flat trailing window, compare the point to
 * the values at the same phase in prior cycles — `values[i-period]`,
 * `values[i-2·period]`, … For hourly samples, `period = 24` is the hour-of-day
 * baseline and `period = 24·7` is the day-of-week × hour-of-day baseline. This
 * is the eval-rig analogue of the detector's seasonal window, so the rig can
 * prove (and CI can guard) that seasonality lifts PR-AUC on periodic series
 * where a flat window mistakes the cycle itself for anomalies.
 *
 * Points with fewer than `minHistory` prior same-phase samples are warm-up
 * (`null`). One-sided (drops score 0), mirroring `scoreSeriesRobust`.
 */
export function scoreSeriesSeasonalRobust(
  values: readonly number[],
  period: number,
  minHistory = 3,
): Array<number | null> {
  const scores: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    const history: number[] = [];
    for (let j = i - period; j >= 0; j -= period) history.push(values[j]);
    if (history.length < minHistory) {
      scores.push(null);
      continue;
    }
    const { median, mad } = medianAndMad(history);
    if (mad === 0) {
      const tol = Math.max(Math.abs(median) * 0.1, 0.01);
      scores.push(Math.max(0, (values[i] - median) / tol));
    } else {
      scores.push(Math.max(0, modifiedZScore(values[i], median, mad)));
    }
  }
  return scores;
}

/**
 * Score each point with the legacy TWO-SIDED z-score (mean + std) — the
 * pre-#1361/#1362 detector. Kept so the eval rig can quantify the improvement
 * (and guard against regressing back toward it).
 */
export function scoreSeriesZScore(
  values: readonly number[],
  windowSize: number,
): Array<number | null> {
  const scores: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    if (i < windowSize) {
      scores.push(null);
      continue;
    }
    const window = values.slice(i - windowSize, i);
    const { mean, std } = meanAndStd(window);
    if (std === 0) {
      const tol = Math.max(Math.abs(mean) * 0.1, 0.01);
      scores.push(Math.abs(values[i] - mean) / tol);
    } else {
      scores.push(Math.abs((values[i] - mean) / std));
    }
  }
  return scores;
}
