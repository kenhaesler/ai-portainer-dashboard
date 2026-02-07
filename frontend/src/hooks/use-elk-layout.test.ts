import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// vi.hoisted ensures mockLayout is available when vi.mock runs (hoisted above imports)
const { mockLayout } = vi.hoisted(() => ({
  mockLayout: vi.fn(),
}));

vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class MockELK {
    layout = mockLayout;
  },
}));

import { useElkLayout, type ElkLayoutNode, type ElkLayoutEdge } from './use-elk-layout';

beforeEach(() => {
  mockLayout.mockReset();
  // Default: position children at index * 200
  mockLayout.mockImplementation(
    async (graph: { children?: Array<{ id: string; width: number; height: number }> }) => ({
      ...graph,
      children: (graph.children ?? []).map((child, i) => ({
        ...child,
        x: i * 200,
        y: i * 150,
      })),
    }),
  );
});

describe('useElkLayout', () => {
  it('returns empty map for empty input', () => {
    const { result } = renderHook(() => useElkLayout({ nodes: [], edges: [] }));

    expect(result.current.size).toBe(0);
    expect(mockLayout).not.toHaveBeenCalled();
  });

  it('returns positions for each input node', async () => {
    const nodes: ElkLayoutNode[] = [
      { id: 'stack-A', width: 400, height: 300 },
      { id: 'stack-B', width: 400, height: 300 },
      { id: 'net-ext', width: 120, height: 80 },
    ];
    const edges: ElkLayoutEdge[] = [
      { id: 'net-ext--stack-A', source: 'net-ext', target: 'stack-A' },
    ];

    const { result } = renderHook(() => useElkLayout({ nodes, edges }));

    await waitFor(() => {
      expect(result.current.size).toBe(3);
    });

    expect(result.current.has('stack-A')).toBe(true);
    expect(result.current.has('stack-B')).toBe(true);
    expect(result.current.has('net-ext')).toBe(true);
  });

  it('returns numeric x and y for each node', async () => {
    const nodes: ElkLayoutNode[] = [{ id: 'stack-A', width: 400, height: 300 }];

    const { result } = renderHook(() => useElkLayout({ nodes, edges: [] }));

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    const pos = result.current.get('stack-A')!;
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });

  it('produces deterministic positions for the same input', async () => {
    const nodes: ElkLayoutNode[] = [
      { id: 'stack-A', width: 400, height: 300 },
      { id: 'stack-B', width: 300, height: 250 },
    ];

    const { result: r1 } = renderHook(() => useElkLayout({ nodes, edges: [] }));
    const { result: r2 } = renderHook(() => useElkLayout({ nodes, edges: [] }));

    await waitFor(() => expect(r1.current.size).toBe(2));
    await waitFor(() => expect(r2.current.size).toBe(2));

    expect(r1.current.get('stack-A')).toEqual(r2.current.get('stack-A'));
    expect(r1.current.get('stack-B')).toEqual(r2.current.get('stack-B'));
  });

  it('passes nodes with width/height and edges in elkjs format', async () => {
    const nodes: ElkLayoutNode[] = [
      { id: 'stack-A', width: 400, height: 300 },
      { id: 'net-1', width: 120, height: 80 },
    ];
    const edges: ElkLayoutEdge[] = [
      { id: 'net-1--stack-A', source: 'net-1', target: 'stack-A' },
    ];

    renderHook(() => useElkLayout({ nodes, edges }));

    await waitFor(() => {
      expect(mockLayout).toHaveBeenCalledTimes(1);
    });

    const graphArg = mockLayout.mock.calls[0][0];
    expect(graphArg.id).toBe('root');
    expect(graphArg.children).toHaveLength(2);
    expect(graphArg.children[0]).toEqual({ id: 'stack-A', width: 400, height: 300 });
    expect(graphArg.edges).toHaveLength(1);
    expect(graphArg.edges[0]).toEqual({
      id: 'net-1--stack-A',
      sources: ['net-1'],
      targets: ['stack-A'],
    });
  });

  it('does not re-run layout when input is unchanged', async () => {
    const nodes: ElkLayoutNode[] = [{ id: 'stack-A', width: 400, height: 300 }];

    const { rerender } = renderHook(() => useElkLayout({ nodes, edges: [] }));

    await waitFor(() => {
      expect(mockLayout).toHaveBeenCalledTimes(1);
    });

    rerender();

    expect(mockLayout).toHaveBeenCalledTimes(1);
  });
});
