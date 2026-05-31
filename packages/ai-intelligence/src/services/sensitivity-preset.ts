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
 * The post-filter reads the typed `z_score` column persisted by the detectors
 * (#1308). Records whose |z-score| is BELOW the effective threshold are dropped
 * before they leave the API; records without a z-score pass through.
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
 * Returns true if the insight should be VISIBLE under the user's preset.
 *
 * Reads the typed `z_score` column (#1308). Records without a z-score
 * (`null` / `undefined` — predictive forecasts, isolation-forest, threshold,
 * error-rate-only trace anomalies) always pass through; the preset only filters
 * z-score-based anomalies. pg returns NUMERIC as a string, so the value is
 * coerced before comparison; non-finite values pass through (conservative).
 *
 * This is Option A from issue #1297 (post-filter on read): the detectors write
 * everything, the per-user view filters.
 */
export function shouldIncludeAnomaly(
  insight: { z_score?: number | string | null; category?: string | null },
  preset: SensitivityPreset,
  defaults: { zScore: number; contamination: number },
): boolean {
  if (insight.z_score === null || insight.z_score === undefined) return true;
  const z = typeof insight.z_score === 'number' ? insight.z_score : Number(insight.z_score);
  if (!Number.isFinite(z)) return true;
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
