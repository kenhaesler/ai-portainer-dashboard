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
  // Default: position root children at index * 200, auto-size compound nodes
  mockLayout.mockImplementation(async (graph: any) => {
    const processChildren = (children: any[], startX = 0, startY = 0): any[] =>
      children.map((child: any, i: number) => {
        const result: any = {
          ...child,
          x: startX + i * 200,
          y: startY + i * 150,
        };
        if (child.children?.length) {
          result.children = processChildren(child.children, 20, 35);
          // Simulate auto-sizing compound node from children
          const maxX = Math.max(...result.children.map((c: any) => (c.x ?? 0) + (c.width ?? 100)));
          const maxY = Math.max(...result.children.map((c: any) => (c.y ?? 0) + (c.height ?? 80)));
          result.width = maxX + 20;
          result.height = maxY + 15;
        }
        return result;
      });

    return {
      ...graph,
      children: processChildren(graph.children ?? []),
    };
  });
});

describe('useElkLayout', () => {
  it('returns empty map for empty input', () => {
    const { result } = renderHook(() => useElkLayout({ nodes: [], edges: [] }));

    expect(result.current.size).toBe(0);
    expect(mockLayout).not.toHaveBeenCalled();
  });

  it('returns positions for flat nodes', async () => {
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

  it('returns LayoutPosition with numeric x, y, width, height', async () => {
    const nodes: ElkLayoutNode[] = [{ id: 'stack-A', width: 400, height: 300 }];

    const { result } = renderHook(() => useElkLayout({ nodes, edges: [] }));

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    const pos = result.current.get('stack-A')!;
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
    expect(typeof pos.width).toBe('number');
    expect(typeof pos.height).toBe('number');
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

  it('passes leaf nodes with width/height and edges in elkjs format', async () => {
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

  it('returns positions for compound nodes and their children', async () => {
    const nodes: ElkLayoutNode[] = [
      {
        id: 'group-A',
        width: 0,
        height: 0,
        children: [
          { id: 'child-1', width: 120, height: 80 },
          { id: 'child-2', width: 120, height: 80 },
        ],
        edges: [{ id: 'e-1', source: 'child-1', target: 'child-2' }],
        layoutOptions: { 'elk.algorithm': 'layered' },
      },
      { id: 'net-ext', width: 120, height: 80 },
    ];
    const edges: ElkLayoutEdge[] = [
      { id: 'e-cross', source: 'child-1', target: 'net-ext' },
    ];

    const { result } = renderHook(() => useElkLayout({ nodes, edges }));

    await waitFor(() => {
      // 4 total: group-A, child-1, child-2, net-ext
      expect(result.current.size).toBe(4);
    });

    // Group auto-sized (width/height > 0 from children)
    const groupPos = result.current.get('group-A')!;
    expect(groupPos.width).toBeGreaterThan(0);
    expect(groupPos.height).toBeGreaterThan(0);

    // Children have positions
    expect(result.current.has('child-1')).toBe(true);
    expect(result.current.has('child-2')).toBe(true);
    expect(result.current.has('net-ext')).toBe(true);
  });

  it('omits width/height for compound nodes (width=0) when calling elkjs', async () => {
    const nodes: ElkLayoutNode[] = [
      {
        id: 'group-A',
        width: 0,
        height: 0,
        children: [{ id: 'child-1', width: 100, height: 50 }],
      },
    ];

    renderHook(() => useElkLayout({ nodes, edges: [] }));

    await waitFor(() => {
      expect(mockLayout).toHaveBeenCalledTimes(1);
    });

    const graphArg = mockLayout.mock.calls[0][0];
    const groupNode = graphArg.children[0];
    // Compound node should NOT have width/height set (auto-sizing)
    expect(groupNode.width).toBeUndefined();
    expect(groupNode.height).toBeUndefined();
    // But should have children
    expect(groupNode.children).toHaveLength(1);
    expect(groupNode.children[0]).toEqual({ id: 'child-1', width: 100, height: 50 });
  });

  it('passes intra-group edges at the group level in elkjs format', async () => {
    const nodes: ElkLayoutNode[] = [
      {
        id: 'group-A',
        width: 0,
        height: 0,
        children: [
          { id: 'c1', width: 100, height: 50 },
          { id: 'n1', width: 100, height: 50 },
        ],
        edges: [{ id: 'e-c1-n1', source: 'c1', target: 'n1' }],
      },
    ];

    renderHook(() => useElkLayout({ nodes, edges: [] }));

    await waitFor(() => {
      expect(mockLayout).toHaveBeenCalledTimes(1);
    });

    const graphArg = mockLayout.mock.calls[0][0];
    const groupNode = graphArg.children[0];
    expect(groupNode.edges).toHaveLength(1);
    expect(groupNode.edges[0]).toEqual({
      id: 'e-c1-n1',
      sources: ['c1'],
      targets: ['n1'],
    });
  });
});
