/**
 * Feedback → threshold loop (#1364). Closes the loop opened by the labelled
 * store: given the measured per-detector false-positive rate (from operator
 * #1298 feedback), recommend a threshold adjustment toward a target FP rate.
 *
 * Pure and conservative: it nudges the threshold by one multiplicative step at a
 * time, only outside a deadband around the target, only with enough labelled
 * samples, and always within bounds. Callers decide whether to apply the
 * recommendation (e.g. write it to settings) or just surface it.
 */

export type TuneReason =
  | 'too-many-fp'
  | 'too-strict'
  | 'within-target'
  | 'insufficient-data';

export interface ThresholdRecommendation {
  threshold: number;
  changed: boolean;
  reason: TuneReason;
}

export interface TuneOptions {
  /** Current detector threshold (e.g. ANOMALY_ZSCORE_THRESHOLD). */
  current: number;
  /** Measured FP rate in [0,1] from the labelled store. */
  measuredFpRate: number;
  /** How many conclusively-labelled anomalies the rate is based on. */
  sampleCount: number;
  /** Desired FP rate (default 0.05). */
  targetFpRate?: number;
  /** Deadband around the target within which we hold (default 0.02). */
  tolerance?: number;
  /** Multiplicative step per adjustment (default 0.1 = ±10%). */
  step?: number;
  /** Minimum labelled samples before tuning (default 20). */
  minSamples?: number;
  /** Threshold bounds (defaults 1.5 / 8). */
  min?: number;
  max?: number;
}

export function recommendThreshold(opts: TuneOptions): ThresholdRecommendation {
  const targetFpRate = opts.targetFpRate ?? 0.05;
  const tolerance = opts.tolerance ?? 0.02;
  const step = opts.step ?? 0.1;
  const minSamples = opts.minSamples ?? 20;
  const min = opts.min ?? 1.5;
  const max = opts.max ?? 8;
  const { current } = opts;

  if (opts.sampleCount < minSamples) {
    return { threshold: current, changed: false, reason: 'insufficient-data' };
  }

  if (opts.measuredFpRate > targetFpRate + tolerance) {
    // Too many false positives → raise the threshold (stricter).
    const next = Math.min(max, current * (1 + step));
    return { threshold: next, changed: next !== current, reason: 'too-many-fp' };
  }

  if (opts.measuredFpRate < targetFpRate - tolerance) {
    // Very few false positives → likely too strict; lower the threshold to
    // recover sensitivity.
    const next = Math.max(min, current * (1 - step));
    return { threshold: next, changed: next !== current, reason: 'too-strict' };
  }

  return { threshold: current, changed: false, reason: 'within-target' };
}
