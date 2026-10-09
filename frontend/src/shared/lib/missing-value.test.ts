import { describe, it, expect } from 'vitest';
import { NO_VALUE, NO_SAMPLES_QUALIFIER, formatOrNoValue } from './missing-value';

describe('formatOrNoValue (invariant #7)', () => {
  it('renders the shared dash for unknown values, never a zero', () => {
    expect(formatOrNoValue(null, (n) => `${n}%`)).toBe(NO_VALUE);
    expect(formatOrNoValue(undefined, (n) => `${n}%`)).toBe(NO_VALUE);
    expect(formatOrNoValue(Number.NaN, (n) => `${n}%`)).toBe(NO_VALUE);
  });

  it('formats a real zero as a zero — a measured 0 is not a missing sample', () => {
    expect(formatOrNoValue(0, (n) => `${n.toFixed(1)}%`)).toBe('0.0%');
  });

  it('formats real values with the supplied formatter', () => {
    expect(formatOrNoValue(12.345, (n) => `${n.toFixed(1)} ms`)).toBe('12.3 ms');
  });

  it('exposes the qualifier wording used beside the dash', () => {
    expect(NO_SAMPLES_QUALIFIER).toBe('no samples in range');
  });
});
