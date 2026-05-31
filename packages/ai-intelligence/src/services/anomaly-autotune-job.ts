/**
 * Production wiring for the gated auto-tune loop (#1364). Binds the pure
 * orchestrator (`runAutoTune`) and DB feedback source (`measureFpRateFromDb`) to
 * the global settings store and audit log so a scheduled job can close the loop.
 *
 * The collaborators are injected as primitives (db, getSetting, setSetting,
 * writeAuditLog) so the wiring — setting-key parse/format and audit shape — is
 * unit-testable end-to-end without mocking `@dashboard/core` modules. The
 * scheduler binds the real core functions.
 */

import { runAutoTune, type AutoTuneResult } from './anomaly-autotune.js';
import { measureFpRateFromDb, type FeedbackDb } from './anomaly-feedback-source.js';

/** Settings key the metric ('ml-anomaly') z-score/robust detector reads each cycle. */
export const ANOMALY_THRESHOLD_SETTING_KEY = 'ai_tuning.anomaly_zscore_threshold';

/** The detector whose feedback drives this knob (writes detection_method 'ml-anomaly'). */
const DEFAULT_DETECTOR = 'ml-anomaly';

export interface AutoTuneJobPrimitives {
  enabled: boolean;
  /** Env-config threshold, used when the settings row is absent/unparseable. */
  envThreshold: number;
  /** Override the tuned detector (defaults to 'ml-anomaly'). */
  detector?: string;
  targetFpRate: number;
  minSamples: number;
  lookbackDays: number;
  db: FeedbackDb;
  getSetting: (key: string) => Promise<{ value: string } | null>;
  setSetting: (key: string, value: string, category: string) => Promise<void>;
  writeAuditLog: (entry: {
    username?: string;
    action: string;
    target_type?: string;
    target_id?: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
}

export async function runAnomalyAutoTuneJob(p: AutoTuneJobPrimitives): Promise<AutoTuneResult> {
  const detector = p.detector ?? DEFAULT_DETECTOR;

  return runAutoTune(
    {
      enabled: p.enabled,
      getMeasuredFpRate: (d) => measureFpRateFromDb(p.db, d, { lookbackDays: p.lookbackDays }),
      getCurrentThreshold: async () => {
        const row = await p.getSetting(ANOMALY_THRESHOLD_SETTING_KEY);
        const parsed = row ? Number(row.value) : Number.NaN;
        // Empty string coerces to 0 via Number(); guard it so a blank setting
        // falls back to the env default rather than collapsing the threshold.
        return Number.isFinite(parsed) && row?.value.trim() !== '' ? parsed : p.envThreshold;
      },
      applyThreshold: (next) =>
        p.setSetting(ANOMALY_THRESHOLD_SETTING_KEY, String(next), 'ai_tuning'),
      audit: (e) =>
        p.writeAuditLog({
          username: 'system',
          action: 'anomaly_threshold_autotuned',
          target_type: 'anomaly_detector',
          target_id: ANOMALY_THRESHOLD_SETTING_KEY,
          details: { ...e },
        }),
    },
    { detector, targetFpRate: p.targetFpRate, minSamples: p.minSamples },
  );
}
