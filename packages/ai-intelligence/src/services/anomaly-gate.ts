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
  if (config.ANOMALY_PERSISTENCE_ENABLED === false) {
    return { emit: opts.isAnomalous, reason: 'disabled' };
  }

  const m = config.ANOMALY_PERSISTENCE_M;
  const n = config.ANOMALY_PERSISTENCE_N;
  const fastBurn = config.ANOMALY_FAST_BURN_MULTIPLIER;

  // Always record the decision so the window rolls correctly cycle-to-cycle,
  // even on non-anomalous cycles.
  const anomalousCount = await getPersistenceStore().record(opts.key, opts.isAnomalous, n);

  if (!opts.isAnomalous) return { emit: false, reason: 'suppressed' };

  // Multi-window short path: a severe single sample pages immediately so brief
  // hard failures are not delayed by the persistence requirement.
  if (opts.severity >= fastBurn) return { emit: true, reason: 'fast-burn' };

  // Long path: require ≥ M of the last N cycles to be anomalous.
  return anomalousCount >= m
    ? { emit: true, reason: 'persistence' }
    : { emit: false, reason: 'suppressed' };
}
