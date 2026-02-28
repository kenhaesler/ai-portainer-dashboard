import { describe, it, expect } from 'vitest';
import { STALE_TIMES } from './query-constants';

describe('STALE_TIMES', () => {
  it('has positive numeric values', () => {
    for (const [key, value] of Object.entries(STALE_TIMES)) {
      expect(value, `${key} should be a positive number`).toBeGreaterThan(0);
    }
  });

  it('values are in ascending order', () => {
    expect(STALE_TIMES.DEFAULT).toBeLessThan(STALE_TIMES.SHORT);
    expect(STALE_TIMES.SHORT).toBeLessThan(STALE_TIMES.MEDIUM);
    expect(STALE_TIMES.MEDIUM).toBeLessThan(STALE_TIMES.LONG);
  });

  it('DEFAULT is 30 seconds', () => {
    expect(STALE_TIMES.DEFAULT).toBe(30_000);
  });

  it('LONG is 5 minutes', () => {
    expect(STALE_TIMES.LONG).toBe(300_000);
  });
});
