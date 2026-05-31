/**
 * Alerting discipline gate (#1363): M-of-N persistence + multi-window.
 *
 * The benchmark in docs/superpowers/specs/2026-05-30-anomaly-detection-ml-review.md
 * showed that robust statistics alone still over-fire on bursty workloads, and
 * that requiring an anomaly to PERSIST (≥ M of the last N cycles) cuts pooled
 * false alarms ~82% — but at the cost of missing brief severe spikes. The fix
 * is multi-window (Google SRE "Alerting on SLOs"): a long persistence window
 * for moderate anomalies, plus a short high-burn-rate path that pages
 * immediately when a single sample is severe.
 */
import { getConfig } from '@dashboard/core/config/index.js';
import { getPersistenceStore } from '@dashboard/core/services/persistence-store.js';

export type ConfirmReason = 'fast-burn' | 'persistence' | 'suppressed' | 'disabled';

export interface ConfirmResult {
  /** Whether this anomaly should be surfaced (inserted) this cycle. */
  emit: boolean;
  reason: ConfirmReason;
  /**
   * Confidence in [0,1] that this is a real, actionable anomaly — the max of the
   * persistence ratio (how many of the last N cycles fired) and the burn
   * magnitude (severity ÷ fast-burn multiplier). Callers route low-confidence
   * anomalies to a quieter tier (#1363).
   */
  confidence: number;
}

/**
 * Decide whether to surface an anomaly, recording the per-cycle decision so the
 * rolling M-of-N window stays accurate.
 *
 * @param key       suppression key, e.g. `${containerId}:${metricType}`
 * @param isAnomalous  the detector's raw decision this cycle
 * @param severity  normalised magnitude = |z| / threshold (1.0 = at threshold);
 *                  ≥ ANOMALY_FAST_BURN_MULTIPLIER takes the fast path
 */
export async function confirmAnomaly(opts: {
  key: string;
  isAnomalous: boolean;
  severity: number;
}): Promise<ConfirmResult> {
  const config = getConfig();
  const fastBurn = config.ANOMALY_FAST_BURN_MULTIPLIER;
  const suppressFloor = config.ANOMALY_SUPPRESS_BELOW_CONFIDENCE;
  const magnitudeFactor = Math.min(1, Math.max(0, opts.severity) / fastBurn);

  if (config.ANOMALY_PERSISTENCE_ENABLED === false) {
    const confidence = opts.isAnomalous ? magnitudeFactor : 0;
    const emit = opts.isAnomalous && confidence >= suppressFloor;
    return { emit, reason: emit ? 'disabled' : 'suppressed', confidence };
  }

  const m = config.ANOMALY_PERSISTENCE_M;
  const n = config.ANOMALY_PERSISTENCE_N;

  // Always record the decision so the window rolls correctly cycle-to-cycle,
  // even on non-anomalous cycles.
  const anomalousCount = await getPersistenceStore().record(opts.key, opts.isAnomalous, n);
  const confidence = Math.max(Math.min(1, anomalousCount / n), magnitudeFactor);

  if (!opts.isAnomalous) return { emit: false, reason: 'suppressed', confidence: 0 };

  // System-wide detection-time suppression floor (#1363): drop the lowest-
  // confidence anomalies entirely so the shared insights table / correlator /
  // notifications stay clean for everyone. Fast-burn has confidence 1.0, so a
  // severe spike is never dropped here.
  if (confidence < suppressFloor) return { emit: false, reason: 'suppressed', confidence };

  // Multi-window short path: a severe single sample pages immediately so brief
  // hard failures are not delayed by the persistence requirement.
  if (opts.severity >= fastBurn) return { emit: true, reason: 'fast-burn', confidence };

  // Long path: require ≥ M of the last N cycles to be anomalous.
  return anomalousCount >= m
    ? { emit: true, reason: 'persistence', confidence }
    : { emit: false, reason: 'suppressed', confidence };
}

/**
 * Map a confirmed anomaly's confidence + magnitude to a severity tier (#1363).
 * Below `minSurface` confidence it routes to 'info' — a quieter log tier that
 * does not page — instead of warning/critical. At or above, severity is by
 * magnitude (|z| > 4 → critical, else warning). minSurface = 0 surfaces all.
 */
export function routeSeverity(
  confidence: number,
  magnitudeZ: number,
  minSurface: number,
): 'critical' | 'warning' | 'info' {
  if (confidence < minSurface) return 'info';
  return Math.abs(magnitudeZ) > 4 ? 'critical' : 'warning';
}
