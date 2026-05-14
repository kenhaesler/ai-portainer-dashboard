import { describe, it, expect } from 'vitest';
import {
  getRpcEdgeColor,
  getRpcEdgeWidth,
  capAndSortRpcEdges,
  type RpcEdgeInput,
} from './topology-graph';

describe('getRpcEdgeColor', () => {
  it('returns green for low error rate (< 1%)', () => {
    expect(getRpcEdgeColor(0)).toBe('#10b981');
    expect(getRpcEdgeColor(0.005)).toBe('#10b981');
  });

  it('returns amber for medium error rate (>= 1% and < 5%)', () => {
    expect(getRpcEdgeColor(0.01)).toBe('#eab308');
    expect(getRpcEdgeColor(0.04)).toBe('#eab308');
  });

  it('returns red for high error rate (>= 5%)', () => {
    expect(getRpcEdgeColor(0.05)).toBe('#ef4444');
    expect(getRpcEdgeColor(0.5)).toBe('#ef4444');
  });

  it('treats undefined as zero error rate', () => {
    expect(getRpcEdgeColor(undefined)).toBe('#10b981');
  });
});

describe('getRpcEdgeWidth', () => {
  it('returns at least the minimum width for zero calls', () => {
    expect(getRpcEdgeWidth(0)).toBeGreaterThanOrEqual(1);
  });

  it('scales with log1p(callCount)', () => {
    const wLow = getRpcEdgeWidth(10);
    const wHigh = getRpcEdgeWidth(10_000);
    expect(wHigh).toBeGreaterThan(wLow);
    // log1p(10000) / log1p(10) ≈ 9.21 / 2.40 ≈ 3.84
    // so wHigh should be roughly that much bigger than the gain from base
    expect(wHigh / wLow).toBeGreaterThan(2);
  });

  it('clamps to a sane maximum to avoid 100px monsters', () => {
    expect(getRpcEdgeWidth(1_000_000_000)).toBeLessThanOrEqual(10);
  });
});

describe('capAndSortRpcEdges', () => {
  const make = (source: string, target: string, callCount: number): RpcEdgeInput => ({
    source,
    target,
    callCount,
  });

  it('sorts by callCount desc', () => {
    const result = capAndSortRpcEdges([
      make('a', 'b', 10),
      make('c', 'd', 100),
      make('e', 'f', 50),
    ]);
    expect(result.map((e) => e.callCount)).toEqual([100, 50, 10]);
  });

  it('caps to 100 edges', () => {
    const edges = Array.from({ length: 150 }, (_, i) =>
      make(`s${i}`, `t${i}`, 1000 - i),
    );
    const result = capAndSortRpcEdges(edges);
    expect(result).toHaveLength(100);
    // top edge should be the highest-callCount
    expect(result[0].callCount).toBe(1000);
  });

  it('returns empty array for empty input', () => {
    expect(capAndSortRpcEdges([])).toEqual([]);
  });

  it('skips self-edges where source === target', () => {
    const result = capAndSortRpcEdges([
      make('a', 'a', 1000),
      make('a', 'b', 100),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('a');
    expect(result[0].target).toBe('b');
  });
});
