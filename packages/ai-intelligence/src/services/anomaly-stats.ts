/**
 * Shared statistical helpers for anomaly detection.
 *
 * Issue #1295 (Fix 2): the coefficient-of-variation (CV = σ / μ) multiplier
 * is applied uniformly across the trace and metric anomaly paths so that
 * naturally noisy services do not trip the detector every time they wobble
 * inside their normal envelope.
 *
 * Release notes — bucket boundaries
 * ─────────────────────────────────
 * The CV → multiplier mapping shipped in #1302 is:
 *
 *   CV < 0.1            (very stable)     → 1.0× threshold
 *   0.1 ≤ CV < 0.3      (medium)          → 1.2× threshold
 *   CV ≥ 0.3            (naturally noisy) → 1.5× threshold
 *
 * This is a deliberate behavioural shift from the legacy `selectMethod` logic
 * that previously lived in `adaptive-anomaly-detector.ts`:
 *
 *   cv > 0.5            → 1.5×
 *   cv > 0.2            → 1.0×   (base threshold)
 *   cv ≤ 0.2            → 1.2×   (slight headroom for very stable series)
 *
 * Operator impact: under the old mapping, very stable services (e.g. cv = 0.05)
 * received a 1.2× multiplier (threshold widened 2.5 → 3.0 / 3.5 → 4.2). Under
 * the new mapping they receive 1.0× — i.e. the base z-score threshold applies.
 * That means previously-quiet, low-variance services may surface NEW anomalies
 * that the old detector would have absorbed as noise headroom. This is
 * intentional (the new mapping is the production-grade spec in #1295) but
 * operators upgrading from `dev` should expect a one-time uptick in alerts on
 * historically stable services.
 *
 * If you change these boundaries, update both this comment and the regression
 * tests in `packages/ai-intelligence/src/__tests__/anomaly-stats.test.ts` so
 * the shift is visible to the next reader.
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
