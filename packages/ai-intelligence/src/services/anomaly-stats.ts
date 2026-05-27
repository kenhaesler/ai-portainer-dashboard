/**
 * Shared statistical helpers for anomaly detection.
 *
 * Issue #1295 (Fix 2): the coefficient-of-variation (CV = σ / μ) multiplier
 * is applied uniformly across the trace and metric anomaly paths so that
 * naturally noisy services do not trip the detector every time they wobble
 * inside their normal envelope.
 *
 * The boundaries below are the production-grade thresholds documented in
 * the issue and mirror the spirit of the historical `selectMethod` logic in
 * `adaptive-anomaly-detector.ts`:
 *
 *   CV < 0.1            (very stable)  → 1.0× threshold
 *   0.1 ≤ CV < 0.3      (medium)        → 1.2× threshold
 *   CV ≥ 0.3            (naturally noisy) → 1.5× threshold
 */

export type CvRegime = 'low' | 'medium' | 'high';

/**
 * Classify a series by its coefficient of variation.
 * A non-positive mean is treated as "low" because CV is undefined and
 * the legacy behavior (no multiplier inflation) is the safest fallback.
 */
export function classifyCv(mean: number, std: number): CvRegime {
  if (!Number.isFinite(mean) || !Number.isFinite(std) || mean <= 0) {
    return 'low';
  }
  const cv = std / mean;
  if (cv < 0.1) return 'low';
  if (cv < 0.3) return 'medium';
  return 'high';
}

/** Multiplier to apply to a z-score threshold for a given CV regime. */
export function cvThresholdMultiplier(regime: CvRegime): number {
  switch (regime) {
    case 'low':
      return 1.0;
    case 'medium':
      return 1.2;
    case 'high':
      return 1.5;
  }
}

/** Convenience: classify + multiply in one call. */
export function scaledThresholdForCv(
  baseThreshold: number,
  mean: number,
  std: number,
): { threshold: number; regime: CvRegime; multiplier: number } {
  const regime = classifyCv(mean, std);
  const multiplier = cvThresholdMultiplier(regime);
  return { threshold: baseThreshold * multiplier, regime, multiplier };
}

/** Population mean and standard deviation. Empty/short series → zero std. */
export function meanAndStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, std: 0 };
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}
