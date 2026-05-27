/**
 * Per-user anomaly Sensitivity preset — issue #1297.
 *
 * The detectors run as background jobs and write the full anomaly set to the
 * shared `insights` table. Each user can tune how much of that set surfaces
 * in their dashboard via a Low/Default/High preset.
 *
 * Multipliers (per the issue body):
 *   Low     — stricter   — z-score × 1.3, contamination × 0.5
 *   Default — today      — z-score × 1.0, contamination × 1.0
 *   High    — looser     — z-score × 0.85, contamination × 2.0 (capped 0.15)
 *
 * The contamination cap matches the env-default of 0.15 (ISOLATION_FOREST
 * accepts ≤ 0.5 but operators shouldn't exceed today's default just by
 * picking High).
 *
 * The post-filter looks at the z-score embedded in the insight's description
 * (the detectors format it as "z-score: X.YZ"). Records whose z-score is
 * BELOW the effective threshold are dropped before they leave the API.
 */
import { z } from 'zod';
import { getConfig } from '@dashboard/core/config/index.js';
import { getUserSetting, setUserSetting } from '@dashboard/core/services/user-settings-store.js';

export const SENSITIVITY_PRESET_KEY = 'monitoring.sensitivity_preset';

export const SensitivityPresetSchema = z.enum(['low', 'default', 'high']);
export type SensitivityPreset = z.infer<typeof SensitivityPresetSchema>;

export const SensitivityPutBodySchema = z.object({
  preset: SensitivityPresetSchema,
});

export const SensitivityResponseSchema = z.object({
  preset: SensitivityPresetSchema,
});

interface PresetMultipliers {
  zScore: number;
  contamination: number;
}

const PRESET_MULTIPLIERS: Record<SensitivityPreset, PresetMultipliers> = {
  low: { zScore: 1.3, contamination: 0.5 },
  default: { zScore: 1.0, contamination: 1.0 },
  high: { zScore: 0.85, contamination: 2.0 },
};

const CONTAMINATION_CEILING = 0.15;

/**
 * Effective per-user thresholds. Pure — no DB / no env reads in the body,
 * caller passes the config defaults in. This makes the function trivially
 * unit-testable with all three presets against the same defaults.
 */
export function effectiveThresholds(
  preset: SensitivityPreset,
  defaults: { zScore: number; contamination: number },
): { zScore: number; contamination: number } {
  const m = PRESET_MULTIPLIERS[preset];
  return {
    zScore: defaults.zScore * m.zScore,
    contamination: Math.min(defaults.contamination * m.contamination, CONTAMINATION_CEILING),
  };
}

/**
 * Reads the calling user's preset from the user_settings table, falling back
 * to 'default' if unset or if the stored value isn't a known preset name.
 */
export async function getUserPreset(userId: string): Promise<SensitivityPreset> {
  const raw = await getUserSetting(userId, SENSITIVITY_PRESET_KEY);
  if (raw === null) return 'default';
  const parsed = SensitivityPresetSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'default';
}

export async function setUserPreset(userId: string, preset: SensitivityPreset): Promise<void> {
  // Validate again at the boundary — the route also validates, but a direct
  // caller from another service should not be able to bypass.
  const parsed = SensitivityPresetSchema.parse(preset);
  await setUserSetting(userId, SENSITIVITY_PRESET_KEY, parsed);
}

/**
 * Pull the z-score out of a description string formatted by the detectors:
 * "Current cpu: 95.0% (mean: 40.0%, z-score: 3.50)".
 * Returns null if no z-score is present (non-anomaly insights like
 * predictive forecasts won't have one).
 *
 * WARNING — the detector description format is LOAD-BEARING for this regex.
 * If the detectors ever change their wording (e.g. "z=3.50", localisation,
 * structured metadata), the entire per-user Sensitivity preset feature
 * silently degrades to a pass-through. The follow-up plan (issue #1308) is
 * to persist the z-score as a typed/JSONB column on `insights` so the
 * filter no longer depends on description-string parsing.
 */
export function extractZScore(description: string): number | null {
  // Tolerate negative, decimal, and scientific notation. The detectors round
  // to 2 dp but isolation-forest scores are 0..1 so we accept any number.
  const match = description.match(/z-score:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Returns true if the insight should be VISIBLE under the user's preset.
 *
 * Logic:
 *   - Non-anomaly insights (no parseable z-score) always pass through —
 *     the preset only filters z-score-based anomalies.
 *   - For records with a z-score, |z| must be ≥ effective threshold.
 *
 * This is Option A from the issue (post-filter on read) — the detector
 * writes everything, the user view filters.
 */
export function shouldIncludeAnomaly(
  insight: { description: string; category?: string | null },
  preset: SensitivityPreset,
  defaults: { zScore: number; contamination: number },
): boolean {
  const z = extractZScore(insight.description);
  if (z === null) return true;
  const { zScore: threshold } = effectiveThresholds(preset, defaults);
  return Math.abs(z) >= threshold;
}

/**
 * Reads the env-driven defaults that ship today. Centralised here so the
 * routes don't reach into env.schema directly.
 */
export function getDefaultThresholds(): { zScore: number; contamination: number } {
  const config = getConfig();
  return {
    zScore: config.ANOMALY_ZSCORE_THRESHOLD,
    contamination: config.ISOLATION_FOREST_CONTAMINATION,
  };
}
