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
 * Detection direction (#1361 fix 3). Resource/latency metrics care about
 * increases; a drop below baseline is rarely an incident, so flagging it
 * (two-sided) roughly doubled the false-positive rate. Default is 'spike'.
 */
export type DetectionDirection = 'spike' | 'drop' | 'both';

/**
 * Decide whether a signed deviation crosses the threshold for a given
 * direction. `value` is a z-score (or any signed deviation) and `threshold`
 * its positive cutoff.
 *   spike → value >  threshold
 *   drop  → value < -threshold
 *   both  → |value| > threshold   (legacy two-sided behaviour)
 */
export function exceedsThreshold(
  value: number,
  threshold: number,
  direction: DetectionDirection,
): boolean {
  if (direction === 'spike') return value > threshold;
  if (direction === 'drop') return value < -threshold;
  return Math.abs(value) > threshold;
}

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

/** Median of a numeric series (sorted copy). Empty → 0. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median and Median Absolute Deviation, MAD = median(|x − median|) (#1362).
 *
 * Robust replacements for mean/std: the median and MAD have a breakdown point
 * of 0.5, so up to half the series can be outliers without corrupting the
 * baseline — unlike mean/std, which a single spike inflates (the spike then
 * masks itself, and a sustained regression poisons the window). Empty → zeros.
 */
export function medianAndMad(values: number[]): { median: number; mad: number } {
  if (values.length === 0) return { median: 0, mad: 0 };
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  return { median: med, mad };
}

/**
 * Modified z-score (Iglewicz & Hoaglin): `0.6745 · (x − median) / MAD`.
 *
 * The 0.6745 constant (≈ the 0.75 quantile of the standard normal) scales MAD
 * so the result is comparable to a Gaussian z-score, letting the same
 * thresholds carry over. Returns 0 when MAD is 0 — the zero-spread case is
 * handled by the detector with a relative-tolerance rule (mirrors std === 0).
 */
export function modifiedZScore(value: number, med: number, mad: number): number {
  if (mad === 0) return 0;
  return (0.6745 * (value - med)) / mad;
}
