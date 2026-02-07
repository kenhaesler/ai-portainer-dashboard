import { describe, it, expect } from 'vitest';
import { decimateLTTB, type DataPoint } from './lttb-decimator.js';

function generatePoints(count: number): DataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.now() + i * 60000).toISOString(),
    value: Math.sin(i * 0.1) * 50 + 50,
  }));
}

describe('LTTB Decimator', () => {
  it('returns original data when below threshold', () => {
    const data = generatePoints(10);
    const result = decimateLTTB(data, 200);
    expect(result).toEqual(data);
  });

  it('returns empty array for empty input', () => {
    expect(decimateLTTB([], 200)).toEqual([]);
  });

  it('returns original for 1-2 points', () => {
    const one = generatePoints(1);
    expect(decimateLTTB(one, 200)).toEqual(one);

    const two = generatePoints(2);
    expect(decimateLTTB(two, 200)).toEqual(two);
  });

  it('preserves first and last points', () => {
    const data = generatePoints(1000);
    const result = decimateLTTB(data, 100);

    expect(result[0]).toEqual(data[0]);
    expect(result[result.length - 1]).toEqual(data[data.length - 1]);
  });

  it('reduces data to approximately threshold size', () => {
    const data = generatePoints(1000);
    const result = decimateLTTB(data, 200);

    expect(result.length).toBe(200);
  });

  it('maintains data point shape', () => {
    const data = generatePoints(500);
    const result = decimateLTTB(data, 100);

    for (const point of result) {
      expect(point).toHaveProperty('timestamp');
      expect(point).toHaveProperty('value');
      expect(typeof point.timestamp).toBe('string');
      expect(typeof point.value).toBe('number');
    }
  });

  it('selects representative points from monotonically increasing data', () => {
    const data: DataPoint[] = Array.from({ length: 500 }, (_, i) => ({
      timestamp: new Date(Date.now() + i * 60000).toISOString(),
      value: i,
    }));
    const result = decimateLTTB(data, 50);

    expect(result.length).toBe(50);
    // Values should generally be spread across the range
    const values = result.map((p) => p.value);
    expect(Math.min(...values)).toBe(0); // First point preserved
    expect(Math.max(...values)).toBe(499); // Last point preserved
  });

  it('uses default threshold of 200', () => {
    const data = generatePoints(500);
    const result = decimateLTTB(data);

    expect(result.length).toBe(200);
  });
});
