import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useGroupForceLayout,
  type GroupForceNode,
  type GroupForceLink,
} from './use-group-force-layout';

// Mock d3-force with a self-referencing sim so all chained methods work
vi.mock('d3-force', () => {
  let simNodes: GroupForceNode[] = [];

  function createMockSim() {
    const sim: Record<string, unknown> = {};
    sim.force = vi.fn(() => sim);
    sim.stop = vi.fn(() => sim);
    sim.tick = vi.fn(() => {
      // Spread nodes apart on each tick (simple mock behavior)
      simNodes.forEach((n, i) => {
        n.x = (n.x ?? 0) + (i % 2 === 0 ? 1 : -1);
        n.y = (n.y ?? 0) + (i % 2 === 0 ? 1 : -1);
      });
    });
    return sim;
  }

  return {
    forceSimulation: vi.fn((nodes: GroupForceNode[]) => {
      simNodes = nodes;
      return createMockSim();
    }),
    forceLink: vi.fn(() => ({
      id: vi.fn().mockReturnThis(),
      distance: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
    })),
    forceManyBody: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
    })),
    forceCollide: vi.fn(() => ({})),
    forceCenter: vi.fn(() => ({})),
  };
});

describe('useGroupForceLayout', () => {
  it('returns empty map for empty input', () => {
    const { result } = renderHook(() =>
      useGroupForceLayout({ nodes: [], links: [] }),
    );
    expect(result.current.size).toBe(0);
  });

  it('returns positions for each input node', () => {
    const nodes: GroupForceNode[] = [
      { id: 'stack-A', x: 0, y: 0, radius: 100 },
      { id: 'stack-B', x: 0, y: 0, radius: 100 },
      { id: 'net-ext', x: 0, y: 0, radius: 60 },
    ];
    const links: GroupForceLink[] = [
      { id: 'net-ext--stack-A', source: 'net-ext', target: 'stack-A' },
    ];

    const { result } = renderHook(() =>
      useGroupForceLayout({ nodes, links }),
    );

    expect(result.current.size).toBe(3);
    expect(result.current.has('stack-A')).toBe(true);
    expect(result.current.has('stack-B')).toBe(true);
    expect(result.current.has('net-ext')).toBe(true);
  });

  it('returns numeric x and y for each node', () => {
    const nodes: GroupForceNode[] = [
      { id: 'stack-A', x: 0, y: 0, radius: 100 },
    ];

    const { result } = renderHook(() =>
      useGroupForceLayout({ nodes, links: [] }),
    );

    const pos = result.current.get('stack-A')!;
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });

  it('simulation runs multiple ticks (nodes move from initial position)', () => {
    const nodes: GroupForceNode[] = [
      { id: 'stack-A', x: 0, y: 0, radius: 100 },
      { id: 'stack-B', x: 0, y: 0, radius: 100 },
    ];

    const { result } = renderHook(() =>
      useGroupForceLayout({ nodes, links: [] }),
    );

    // After 300 mock ticks, nodes should have moved from (0,0)
    const posA = result.current.get('stack-A')!;
    const posB = result.current.get('stack-B')!;
    expect(posA.x).not.toBe(0);
    expect(posB.x).not.toBe(0);
  });

  it('is deterministic for the same input', () => {
    const nodes: GroupForceNode[] = [
      { id: 'stack-A', x: 0, y: 0, radius: 100 },
      { id: 'stack-B', x: 0, y: 0, radius: 80 },
    ];
    const links: GroupForceLink[] = [];

    const { result: r1 } = renderHook(() =>
      useGroupForceLayout({ nodes, links }),
    );
    const { result: r2 } = renderHook(() =>
      useGroupForceLayout({ nodes, links }),
    );

    expect(r1.current.get('stack-A')).toEqual(r2.current.get('stack-A'));
    expect(r1.current.get('stack-B')).toEqual(r2.current.get('stack-B'));
  });
});
