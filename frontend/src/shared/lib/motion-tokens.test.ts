import { describe, expect, it } from 'vitest';
import { duration, easing, spring, transition, pageVariants } from './motion-tokens';

describe('motion-tokens', () => {
  /* ── Duration ── */
  it('exports durations in ascending order', () => {
    expect(duration.fast).toBeLessThan(duration.base);
    expect(duration.base).toBeLessThan(duration.slow);
    expect(duration.slow).toBeLessThan(duration.slower);
  });

  it('durations are positive numbers', () => {
    for (const val of Object.values(duration)) {
      expect(val).toBeGreaterThan(0);
    }
  });

  /* ── Easing ── */
  it('easing arrays have 4 elements', () => {
    for (const curve of Object.values(easing)) {
      expect(curve).toHaveLength(4);
    }
  });

  it('easing values are between 0 and 1 (start/end points)', () => {
    for (const curve of Object.values(easing)) {
      expect(curve[0]).toBeGreaterThanOrEqual(0);
      expect(curve[0]).toBeLessThanOrEqual(1);
      expect(curve[2]).toBeGreaterThanOrEqual(0);
      expect(curve[2]).toBeLessThanOrEqual(1);
    }
  });

  /* ── Spring presets ── */
  it('spring presets all have type spring', () => {
    for (const preset of Object.values(spring)) {
      expect(preset.type).toBe('spring');
    }
  });

  it('spring presets have positive stiffness and damping', () => {
    for (const preset of Object.values(spring)) {
      expect(preset.stiffness).toBeGreaterThan(0);
      expect(preset.damping).toBeGreaterThan(0);
    }
  });

  /* ── Transition presets ── */
  it('transition presets reference duration values', () => {
    expect(transition.fast.duration).toBe(duration.fast);
    expect(transition.base.duration).toBe(duration.base);
    expect(transition.slow.duration).toBe(duration.slow);
    expect(transition.slower.duration).toBe(duration.slower);
    expect(transition.page.duration).toBe(duration.slow);
  });

  it('transition presets reference easing arrays', () => {
    expect(transition.fast.ease).toBe(easing.default);
    expect(transition.base.ease).toBe(easing.default);
    expect(transition.slow.ease).toBe(easing.spring);
    expect(transition.page.ease).toBe(easing.spring);
  });

  /* ── Page variants ── */
  it('pageVariants has initial, animate, and exit states', () => {
    expect(pageVariants).toHaveProperty('initial');
    expect(pageVariants).toHaveProperty('animate');
    expect(pageVariants).toHaveProperty('exit');
  });

  it('pageVariants animate state is fully visible', () => {
    expect(pageVariants.animate.opacity).toBe(1);
    expect(pageVariants.animate.y).toBe(0);
    expect(pageVariants.animate.filter).toBe('blur(0px)');
  });
});
