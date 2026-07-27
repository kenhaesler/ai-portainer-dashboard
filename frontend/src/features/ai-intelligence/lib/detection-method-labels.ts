/**
 * The one map from a persisted detector identifier to the words shown for it.
 *
 * There were two, and they contradicted each other on the same screen. The
 * incident-group header and row chips read `signature-meta.ts`, which mapped
 * `ml-anomaly` to **"ML"**; the insight feed 400px below read
 * `insight-card.tsx`, which mapped the same key to **"Metric anomaly"** under a
 * twelve-line comment explaining precisely why it must not say "ML". Both
 * rendered on /health at once, over rows whose own text said
 * `method: adaptive` — a moving average with a threshold.
 *
 * The reasoning had been written down and was still lost, because it lived in a
 * comment rather than in a shared module with a test. Two further keys had
 * quietly diverged as well (`prediction` → "Prediction" vs "Forecast";
 * `health-check` → "Health Check" vs "Healthcheck").
 *
 * Rules this map encodes, and `detection-method-labels.test.ts` enforces:
 *
 *  - **The label names the detector, not the technique.** The backend writes
 *    `ml-anomaly` for both the adaptive z-score path and the isolation-forest
 *    path, so the column genuinely cannot distinguish them. "Metric anomaly"
 *    is what is actually known; "ML" is a claim about the method that the
 *    stored value does not support.
 *  - **No default.** An unrecognised or absent method renders nothing. A badge
 *    is a claim about what ran, and there is no honest fallback.
 */
export const DETECTION_METHOD_LABELS: Record<string, string> = {
  threshold: 'Threshold',
  'ml-anomaly': 'Metric anomaly',
  prediction: 'Forecast',
  'health-check': 'Healthcheck',
  'log-pattern': 'Log pattern',
  'security-scan': 'Security scan',
  // Signature-derived variants. `deriveSignature` falls back to `security:scan`,
  // `log:pattern` and `ai:analysis` when an insight carries no detection_method
  // column, so the signature parser sees these shorter tokens for the same
  // concepts. They must resolve to the same words as their long forms above.
  scan: 'Security scan',
  pattern: 'Log pattern',
  network: 'Network',
  analysis: 'AI analysis',
};

/**
 * Words for a detector identifier, or `null` when there are none to honestly
 * show. Never invents a label.
 */
export function detectionMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  return DETECTION_METHOD_LABELS[method] ?? null;
}
