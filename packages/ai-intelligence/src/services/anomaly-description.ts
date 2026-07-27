/**
 * Description text for metric anomalies.
 *
 * These strings are the operator's primary evidence, and they were making
 * three claims the data did not support:
 *
 *  1. `confidence: 1.00` on every anomaly. It is not a measurement —
 *     `anomaly-gate.ts` computes `Math.max(persistence, magnitude)` where the
 *     magnitude term saturates at 1 for any large z-score. It appeared ~40
 *     times on one screen inside the same parenthesis as `mean:` and
 *     `z-score:`, typographically indistinguishable from real statistics, and
 *     read as "we are 100% certain". It is a restatement of the z-score
 *     printed eight characters earlier, so it is gone.
 *
 *  2. `z-score: 1116.00` beside `mean: 0.0%`. A z-score that large means the
 *     standard deviation collapsed toward zero — the figure is an artefact of
 *     dividing by ~0, not a measure of surprise. Rendered to two decimals in a
 *     confident sentence it was the loudest number on the page and the least
 *     interpretable. Above `Z_SCORE_REPORTABLE_MAX` we say the baseline was
 *     flat instead of printing the quotient.
 *
 *  3. `This is 39.8 standard deviations from the moving average.` restated
 *     `z-score: 39.78` from the clause before it, in words.
 *
 * The maths was never wrong. Only the framing was.
 */

/**
 * Above this, a z-score is reporting a collapsed denominator rather than a
 * meaningful distance. Chosen well clear of any genuine signal: a real
 * deviation of 50 sigma does not occur in container metrics without the
 * baseline having gone flat first.
 */
export const Z_SCORE_REPORTABLE_MAX = 50;

export interface AnomalyDescriptionInput {
  metricType: string;
  currentValue: number;
  mean: number;
  zScore: number;
  method?: string;
}

/**
 * Whether a z-score is a usable figure or a divide-by-almost-zero artefact.
 */
export function isReportableZScore(zScore: number): boolean {
  return Number.isFinite(zScore) && Math.abs(zScore) <= Z_SCORE_REPORTABLE_MAX;
}

export function formatAnomalyDescription(input: AnomalyDescriptionInput): string {
  const { metricType, currentValue, mean, zScore } = input;
  const method = input.method ?? 'zscore';
  const head = `Current ${metricType}: ${currentValue.toFixed(1)}%`;

  if (!isReportableZScore(zScore)) {
    // No z-score: it would be a number about the denominator, not the metric.
    return (
      `${head} (mean: ${mean.toFixed(1)}%, method: ${method}). ` +
      `The baseline for this container is flat, so the size of the deviation ` +
      `cannot be expressed as a z-score — compare against the recent history instead.`
    );
  }

  return `${head} (mean: ${mean.toFixed(1)}%, z-score: ${zScore.toFixed(2)}, method: ${method}).`;
}
