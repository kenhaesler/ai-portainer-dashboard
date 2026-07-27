import { describe, it, expect } from 'vitest';
import {
  formatAnomalyDescription,
  isReportableZScore,
  Z_SCORE_REPORTABLE_MAX,
} from './anomaly-description.js';

/**
 * These strings are the operator's primary evidence on /health, so what they
 * claim matters as much as the maths behind them. All three regressions below
 * were visible ~40 times on a single screen.
 */
describe('formatAnomalyDescription', () => {
  const base = { metricType: 'memory', currentValue: 5.7, mean: 3.3, method: 'adaptive' };

  it('never prints a confidence figure', () => {
    // `confidence` is Math.max(persistence, magnitude) where the magnitude term
    // saturates at 1 for any large z-score, so it read `confidence: 1.00` on
    // every anomaly — inside the same parenthesis as the real statistics, and
    // indistinguishable from them. It restates the z-score beside it.
    const text = formatAnomalyDescription({ ...base, zScore: 39.78 });

    expect(text).not.toMatch(/confidence/i);
    expect(text).not.toContain('1.00');
  });

  it('does not restate the z-score in words', () => {
    // "This is 39.8 standard deviations from the moving average." said again,
    // in English, what "z-score: 39.78" said eight characters earlier.
    const text = formatAnomalyDescription({ ...base, zScore: 39.78 });

    expect(text).not.toMatch(/standard deviations from the moving average/i);
    expect(text).toContain('z-score: 39.78');
  });

  it('keeps the figures an operator can act on', () => {
    const text = formatAnomalyDescription({ ...base, zScore: 5.2 });

    expect(text).toBe('Current memory: 5.7% (mean: 3.3%, z-score: 5.20, method: adaptive).');
  });

  it('refuses to print a z-score produced by a collapsed baseline', () => {
    // `z-score: 1116.00` beside `mean: 0.0%` is a division artefact: the
    // standard deviation went to ~0. Rendered to two decimals it was the
    // loudest and least interpretable number on the page.
    const text = formatAnomalyDescription({
      metricType: 'cpu', currentValue: 11.2, mean: 0, zScore: 1116, method: 'adaptive',
    });

    expect(text).not.toContain('1116');
    expect(text).toMatch(/baseline for this container is flat/i);
    expect(text).toContain('Current cpu: 11.2%');
    expect(text).toContain('mean: 0.0%');
  });

  it('still reports a large-but-plausible z-score', () => {
    const text = formatAnomalyDescription({ ...base, zScore: Z_SCORE_REPORTABLE_MAX });

    expect(text).toContain(`z-score: ${Z_SCORE_REPORTABLE_MAX.toFixed(2)}`);
  });

  it('handles a negative deviation symmetrically', () => {
    expect(isReportableZScore(-4)).toBe(true);
    expect(isReportableZScore(-1116)).toBe(false);
    expect(formatAnomalyDescription({ ...base, zScore: -4 })).toContain('z-score: -4.00');
  });

  it('treats a non-finite z-score as unreportable', () => {
    // std of exactly 0 yields Infinity or NaN rather than a large finite value.
    expect(isReportableZScore(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isReportableZScore(Number.NaN)).toBe(false);
    expect(formatAnomalyDescription({ ...base, zScore: Number.POSITIVE_INFINITY }))
      .toMatch(/cannot be expressed as a z-score/i);
  });

  it('defaults the method rather than printing undefined', () => {
    const text = formatAnomalyDescription({
      metricType: 'cpu', currentValue: 9, mean: 4, zScore: 3,
    });

    expect(text).toContain('method: zscore');
  });
});
