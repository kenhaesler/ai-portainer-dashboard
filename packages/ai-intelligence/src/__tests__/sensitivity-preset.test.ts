/**
 * Unit coverage for the per-user Sensitivity preset logic (issue #1297).
 *
 * Covers:
 *   1. Multiplier math (Low/Default/High) against the configured defaults.
 *   2. Contamination ceiling (High preset can't push the IsoForest above
 *      the configured env-default 0.15).
 *   3. shouldIncludeAnomaly reads the typed z_score column (#1308).
 *   4. shouldIncludeAnomaly drops records under threshold and passes
 *      non-anomaly rows (no z_score value) through unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  effectiveThresholds,
  shouldIncludeAnomaly,
  SensitivityPresetSchema,
} from '../services/sensitivity-preset.js';

const DEFAULTS = { zScore: 3.5, contamination: 0.15 };

describe('effectiveThresholds', () => {
  it('Default returns the configured defaults unchanged', () => {
    expect(effectiveThresholds('default', DEFAULTS)).toEqual({
      zScore: 3.5,
      contamination: 0.15,
    });
  });

  it('Low multiplies z-score by 1.3 and contamination by 0.5', () => {
    const t = effectiveThresholds('low', DEFAULTS);
    expect(t.zScore).toBeCloseTo(4.55, 5);
    expect(t.contamination).toBeCloseTo(0.075, 5);
  });

  it('High multiplies z-score by 0.85 and contamination by 2.0, capped at 0.15', () => {
    const t = effectiveThresholds('high', DEFAULTS);
    expect(t.zScore).toBeCloseTo(2.975, 5);
    // 0.15 * 2.0 = 0.30 → capped at 0.15
    expect(t.contamination).toBe(0.15);
  });

  it('High does not exceed the contamination ceiling even with lower defaults', () => {
    const t = effectiveThresholds('high', { zScore: 2.0, contamination: 0.05 });
    // 0.05 * 2.0 = 0.10 → below ceiling, returned as-is
    expect(t.contamination).toBeCloseTo(0.10, 5);
  });

  it('three presets produce three distinct effective thresholds on the same data', () => {
    const low = effectiveThresholds('low', DEFAULTS).zScore;
    const def = effectiveThresholds('default', DEFAULTS).zScore;
    const high = effectiveThresholds('high', DEFAULTS).zScore;

    expect(low).toBeGreaterThan(def);
    expect(def).toBeGreaterThan(high);
  });
});

describe('shouldIncludeAnomaly (typed z_score column — #1308)', () => {
  it('passes through insights without a z-score (null/undefined) under every preset', () => {
    const rows = [
      { z_score: null, category: 'predictive' as const },
      { category: 'predictive' as const }, // z_score undefined
    ];
    for (const row of rows) {
      expect(shouldIncludeAnomaly(row, 'low', DEFAULTS)).toBe(true);
      expect(shouldIncludeAnomaly(row, 'default', DEFAULTS)).toBe(true);
      expect(shouldIncludeAnomaly(row, 'high', DEFAULTS)).toBe(true);
    }
  });

  it('coerces pg NUMERIC-as-string before comparing', () => {
    expect(shouldIncludeAnomaly({ z_score: '3.60' }, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly({ z_score: '3.40' }, 'default', DEFAULTS)).toBe(false);
  });

  it('keeps a record when |z| >= effective threshold', () => {
    expect(shouldIncludeAnomaly({ z_score: 3.6 }, 'default', DEFAULTS)).toBe(true);
  });

  it('drops a record when |z| < effective threshold', () => {
    expect(shouldIncludeAnomaly({ z_score: 3.4 }, 'default', DEFAULTS)).toBe(false);
  });

  it('Low preset (stricter) drops records Default would have kept', () => {
    expect(shouldIncludeAnomaly({ z_score: 4.0 }, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly({ z_score: 4.0 }, 'low', DEFAULTS)).toBe(false);
  });

  it('High preset (looser) keeps records Default would have dropped', () => {
    expect(shouldIncludeAnomaly({ z_score: 3.0 }, 'default', DEFAULTS)).toBe(false);
    expect(shouldIncludeAnomaly({ z_score: 3.0 }, 'high', DEFAULTS)).toBe(true);
  });

  it('treats |z| symmetrically (negative z-scores below mean also count)', () => {
    expect(shouldIncludeAnomaly({ z_score: -4.0 }, 'default', DEFAULTS)).toBe(true);
  });

  it('passes through a non-finite z-score (NaN / unparseable string) like a non-anomaly row', () => {
    expect(shouldIncludeAnomaly({ z_score: Number.NaN }, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly({ z_score: 'abc' }, 'default', DEFAULTS)).toBe(true);
  });

  it('issue #1297 AC — three presets produce different visible counts on the same set', () => {
    const items = [2.5, 3.0, 3.6, 4.6, 5.0].map((z) => ({ z_score: z }));
    const counts = (preset: 'low' | 'default' | 'high') =>
      items.filter((i) => shouldIncludeAnomaly(i, preset, DEFAULTS)).length;
    const low = counts('low');
    const def = counts('default');
    const high = counts('high');
    expect(low).toBeLessThan(def);
    expect(def).toBeLessThan(high);
    expect(new Set([low, def, high]).size).toBe(3);
  });
});

describe('SensitivityPresetSchema', () => {
  it('accepts the three valid presets', () => {
    expect(SensitivityPresetSchema.parse('low')).toBe('low');
    expect(SensitivityPresetSchema.parse('default')).toBe('default');
    expect(SensitivityPresetSchema.parse('high')).toBe('high');
  });

  it('rejects unknown presets', () => {
    expect(() => SensitivityPresetSchema.parse('extreme')).toThrow();
    expect(() => SensitivityPresetSchema.parse('LOW')).toThrow();
    expect(() => SensitivityPresetSchema.parse(null)).toThrow();
  });
});
