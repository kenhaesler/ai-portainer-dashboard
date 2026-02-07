import { describe, it, expect } from 'vitest';
import { selectRollupTable } from './metrics-rollup-selector.js';

describe('Rollup Selector', () => {
  function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  it('selects raw table for <6h range', () => {
    const result = selectRollupTable(hoursAgo(1), new Date());
    expect(result.table).toBe('metrics');
    expect(result.isRollup).toBe(false);
    expect(result.timestampCol).toBe('timestamp');
    expect(result.valueCol).toBe('value');
  });

  it('selects raw table for exactly 5h range', () => {
    const result = selectRollupTable(hoursAgo(5), new Date());
    expect(result.table).toBe('metrics');
    expect(result.isRollup).toBe(false);
  });

  it('selects 5min rollup for 6h-7d range', () => {
    const result = selectRollupTable(hoursAgo(12), new Date());
    expect(result.table).toBe('metrics_5min');
    expect(result.isRollup).toBe(true);
    expect(result.timestampCol).toBe('bucket');
    expect(result.valueCol).toBe('avg_value');
  });

  it('selects raw table for exactly 6h (boundary: <=6h)', () => {
    const result = selectRollupTable(hoursAgo(6), new Date());
    expect(result.table).toBe('metrics');
    expect(result.isRollup).toBe(false);
  });

  it('selects 5min rollup for just over 6h', () => {
    const result = selectRollupTable(hoursAgo(6.1), new Date());
    expect(result.table).toBe('metrics_5min');
    expect(result.isRollup).toBe(true);
  });

  it('selects 1hour rollup for 7d-90d range', () => {
    const result = selectRollupTable(hoursAgo(24 * 14), new Date());
    expect(result.table).toBe('metrics_1hour');
    expect(result.isRollup).toBe(true);
    expect(result.timestampCol).toBe('bucket');
    expect(result.valueCol).toBe('avg_value');
  });

  it('selects 5min rollup for exactly 7 days (boundary: <=7d)', () => {
    const result = selectRollupTable(hoursAgo(24 * 7), new Date());
    expect(result.table).toBe('metrics_5min');
    expect(result.isRollup).toBe(true);
  });

  it('selects 1hour rollup for just over 7 days', () => {
    const result = selectRollupTable(hoursAgo(24 * 7 + 1), new Date());
    expect(result.table).toBe('metrics_1hour');
    expect(result.isRollup).toBe(true);
  });

  it('selects 1day rollup for >90d range', () => {
    const result = selectRollupTable(hoursAgo(24 * 120), new Date());
    expect(result.table).toBe('metrics_1day');
    expect(result.isRollup).toBe(true);
    expect(result.timestampCol).toBe('bucket');
    expect(result.valueCol).toBe('avg_value');
  });

  it('selects 1hour rollup for exactly 90 days (boundary: <=90d)', () => {
    const result = selectRollupTable(hoursAgo(24 * 90), new Date());
    expect(result.table).toBe('metrics_1hour');
    expect(result.isRollup).toBe(true);
  });

  it('selects 1day rollup for just over 90 days', () => {
    const result = selectRollupTable(hoursAgo(24 * 90 + 1), new Date());
    expect(result.table).toBe('metrics_1day');
    expect(result.isRollup).toBe(true);
  });
});
