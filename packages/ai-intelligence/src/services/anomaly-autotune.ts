/**
 * Gated auto-tune orchestrator (#1364). Closes the feedback loop end-to-end:
 * measure the per-detector false-positive rate from operator #1298 feedback,
 * ask `recommendThreshold` for a conservative one-step adjustment, and — only
 * when the `ANOMALY_AUTOTUNE_ENABLED` flag is on — apply it to the global
 * `ai_tuning.anomaly_zscore_threshold` setting and write an audit record.
 *
 * Observer-first: the recommendation is always computed (so the job can log /
 * surface "would change 3.5 → 3.85" even with the flag off), but a threshold is
 * only mutated when explicitly enabled, one bounded step at a time, and every
 * applied change is audited.
 *
 * All side effects (measure, read, apply, audit) are injected so the orchestrator
 * is pure-by-construction and unit-testable without a database; production wiring
 * binds the real settings store, feedback query, and audit logger.
 */

import { recommendThreshold, type TuneReason } from './anomaly-threshold-tuner.js';

export interface AutoTuneDeps {
  /** Master flag — when false, recommend but never apply. */
  enabled: boolean;
  /** Measured FP rate + how many conclusively-labelled anomalies it is based on. */
  getMeasuredFpRate: (detector: string) => Promise<{ rate: number; sampleCount: number }>;
  /** Current effective threshold (settings store value, env fallback). */
  getCurrentThreshold: () => Promise<number>;
  /** Persist a new threshold (e.g. setSetting('ai_tuning.anomaly_zscore_threshold', ...)). */
  applyThreshold: (next: number) => Promise<void>;
  /** Record the applied change for the audit trail. */
  audit: (event: {
    previous: number;
    next: number;
    rate: number;
    sampleCount: number;
    reason: TuneReason;
    detector: string;
  }) => Promise<void>;
}

export interface AutoTuneOptions {
  /** Which detector's feedback drives tuning (default 'ml-anomaly'). */
  detector?: string;
  targetFpRate?: number;
  tolerance?: number;
  step?: number;
  minSamples?: number;
  min?: number;
  max?: number;
}

export interface AutoTuneResult {
  applied: boolean;
  previous: number;
  recommended: number;
  rate: number;
  sampleCount: number;
  reason: TuneReason;
  detector: string;
  /** Why no change was applied, when applied === false. */
  skipped?: 'disabled' | 'no-change';
}

export async function runAutoTune(
  deps: AutoTuneDeps,
  opts: AutoTuneOptions = {},
): Promise<AutoTuneResult> {
  const detector = opts.detector ?? 'ml-anomaly';
  const { rate, sampleCount } = await deps.getMeasuredFpRate(detector);
  const current = await deps.getCurrentThreshold();

  const rec = recommendThreshold({
    current,
    measuredFpRate: rate,
    sampleCount,
    targetFpRate: opts.targetFpRate,
    tolerance: opts.tolerance,
    step: opts.step,
    minSamples: opts.minSamples,
    min: opts.min,
    max: opts.max,
  });

  const base = {
    previous: current,
    recommended: rec.threshold,
    rate,
    sampleCount,
    reason: rec.reason,
    detector,
  };

  // No actionable change (within target, insufficient data, or clamped at a bound).
  if (!rec.changed) {
    return { ...base, applied: false, skipped: 'no-change' };
  }

  // Actionable change, but auto-apply is off — surface it without mutating.
  if (!deps.enabled) {
    return { ...base, applied: false, skipped: 'disabled' };
  }

  await deps.applyThreshold(rec.threshold);
  await deps.audit({
    previous: current,
    next: rec.threshold,
    rate,
    sampleCount,
    reason: rec.reason,
    detector,
  });

  return { ...base, applied: true };
}
