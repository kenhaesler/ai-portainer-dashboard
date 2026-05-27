/**
 * Unit coverage for the per-user Sensitivity preset logic (issue #1297).
 *
 * Covers:
 *   1. Multiplier math (Low/Default/High) against the configured defaults.
 *   2. Contamination ceiling (High preset can't push the IsoForest above
 *      the configured env-default 0.15).
 *   3. Z-score extraction from the detector's description format.
 *   4. shouldIncludeAnomaly drops records under threshold and passes
 *      non-anomaly rows (no parseable z-score) through unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  effectiveThresholds,
  extractZScore,
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

describe('extractZScore', () => {
  it('parses the standard detector format', () => {
    expect(extractZScore('Current cpu: 95.0% (mean: 40.0%, z-score: 3.50)')).toBe(3.5);
  });

  it('parses negative z-scores', () => {
    expect(extractZScore('Latency drop (z-score: -2.95)')).toBe(-2.95);
  });

  it('parses integer z-scores', () => {
    expect(extractZScore('Spike (z-score: 4)')).toBe(4);
  });

  it('returns null when no z-score is present (e.g. predictive forecast)', () => {
    expect(extractZScore('Memory usage forecast indicates threshold breach in 6h')).toBeNull();
  });

  it('returns null on empty description', () => {
    expect(extractZScore('')).toBeNull();
  });
});

describe('shouldIncludeAnomaly', () => {
  const desc = (z: number) => `cpu spike (mean: 40.0%, z-score: ${z.toFixed(2)})`;

  it('passes through insights without a parseable z-score regardless of preset', () => {
    const row = { description: 'Predictive: memory pressure in 6h', category: 'predictive' };
    expect(shouldIncludeAnomaly(row, 'low', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly(row, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly(row, 'high', DEFAULTS)).toBe(true);
  });

  it('keeps a record when |z| >= effective threshold for that preset', () => {
    // Default threshold = 3.5; z = 3.6 passes
    expect(shouldIncludeAnomaly({ description: desc(3.6) }, 'default', DEFAULTS)).toBe(true);
  });

  it('drops a record when |z| < effective threshold', () => {
    // Default threshold = 3.5; z = 3.4 is below
    expect(shouldIncludeAnomaly({ description: desc(3.4) }, 'default', DEFAULTS)).toBe(false);
  });

  it('Low preset (stricter) drops records Default would have kept', () => {
    // z = 4.0 passes Default (3.5) but fails Low (4.55)
    const z40 = { description: desc(4.0) };
    expect(shouldIncludeAnomaly(z40, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly(z40, 'low', DEFAULTS)).toBe(false);
  });

  it('High preset (looser) keeps records Default would have dropped', () => {
    // z = 3.0 fails Default (3.5) but passes High (2.975)
    const z30 = { description: desc(3.0) };
    expect(shouldIncludeAnomaly(z30, 'default', DEFAULTS)).toBe(false);
    expect(shouldIncludeAnomaly(z30, 'high', DEFAULTS)).toBe(true);
  });

  it('treats |z| symmetrically (negative z-scores below mean also count)', () => {
    const negative = { description: desc(-4.0) };
    expect(shouldIncludeAnomaly(negative, 'default', DEFAULTS)).toBe(true);
  });

  it('issue #1297 AC — three presets produce different visible counts on the same set', () => {
    // Synthetic anomaly set spanning the full z-score range. With env
    // defaults (z=3.5, contamination=0.15), each preset should drop a
    // different number of items.
    const items = [2.5, 3.0, 3.6, 4.6, 5.0].map((z) => ({ description: desc(z) }));

    const counts = (preset: 'low' | 'default' | 'high') =>
      items.filter((i) => shouldIncludeAnomaly(i, preset, DEFAULTS)).length;

    const low = counts('low');
    const def = counts('default');
    const high = counts('high');

    // Low strictest, High loosest, Default in the middle.
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
