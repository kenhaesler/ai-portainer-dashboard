import { describe, it, expect } from 'vitest';
import {
  getRpcEdgeColor,
  getRpcEdgeWidth,
  capAndSortRpcEdges,
  matchRpcEdgesToContainers,
  formatEdgeRateLabel,
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

describe('matchRpcEdgesToContainers', () => {
  const make = (source: string, target: string, callCount: number): RpcEdgeInput => ({
    source,
    target,
    callCount,
  });
  const containers = [
    { name: 'container-insights-backend' },
    { name: 'container-insights-redis' },
  ];

  it('matches edges whose endpoints both name a container on canvas', () => {
    const result = matchRpcEdgesToContainers(
      [make('container-insights-backend', 'container-insights-redis', 42)],
      containers,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
    expect(result.unmatchedServices).toEqual([]);
  });

  // The shipped bug: Beyla reports `api-gateway`, no container is called that,
  // every edge hit `continue`, and the graph was dimmed for a layer that drew
  // nothing while the checkbox still read "Observed traffic (3)".
  it('reports the misses instead of silently dropping them', () => {
    const result = matchRpcEdgesToContainers(
      [
        make('api-gateway', 'api-gateway-db', 100),
        make('api-gateway', 'container-insights-redis', 50),
      ],
      containers,
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toHaveLength(2);
    expect(result.unmatchedServices).toEqual(['api-gateway', 'api-gateway-db']);
  });

  it('splits a mixed set and keeps the matched half drawable', () => {
    const result = matchRpcEdgesToContainers(
      [
        make('container-insights-backend', 'container-insights-redis', 10),
        make('api-gateway', 'container-insights-redis', 99),
      ],
      containers,
    );
    expect(result.matched.map((e) => e.source)).toEqual(['container-insights-backend']);
    expect(result.unmatched.map((e) => e.source)).toEqual(['api-gateway']);
    expect(result.unmatchedServices).toEqual(['api-gateway']);
  });

  it('drops self-edges and honours the cap, like the raw sorter', () => {
    const result = matchRpcEdgesToContainers(
      [make('container-insights-redis', 'container-insights-redis', 1000)],
      containers,
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it('returns an empty result for no observed edges', () => {
    const result = matchRpcEdgesToContainers([], containers);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.unmatchedServices).toEqual([]);
  });
});

describe('formatEdgeRateLabel', () => {
  // Thirteen edges all labelled `↓0B/s ↑0B/s` were the highest-contrast
  // repeated element on the canvas and carried no information.
  it('emits nothing when both directions are idle', () => {
    expect(formatEdgeRateLabel({ rxBytesPerSec: 0, txBytesPerSec: 0 })).toBeUndefined();
  });

  it('emits nothing when there is no rate at all', () => {
    expect(formatEdgeRateLabel(undefined)).toBeUndefined();
  });

  it('labels an edge as soon as either direction carries traffic', () => {
    expect(formatEdgeRateLabel({ rxBytesPerSec: 2048, txBytesPerSec: 0 })).toBe(
      '↓2.0KB/s ↑0B/s',
    );
    expect(formatEdgeRateLabel({ rxBytesPerSec: 0, txBytesPerSec: 1 })).toBe(
      '↓0B/s ↑1B/s',
    );
  });

  it('ignores a nonsensical negative sum', () => {
    expect(formatEdgeRateLabel({ rxBytesPerSec: -5, txBytesPerSec: 5 })).toBeUndefined();
  });
});
