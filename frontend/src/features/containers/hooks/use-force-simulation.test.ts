import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// vi.hoisted ensures mocks are available when vi.mock runs (hoisted above imports)
const { mockSimulation } = vi.hoisted(() => {
  const sim = {
    force: vi.fn().mockReturnThis(),
    alphaDecay: vi.fn().mockReturnThis(),
    velocityDecay: vi.fn().mockReturnThis(),
    alpha: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    restart: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    nodes: vi.fn().mockReturnValue([]),
  };
  return { mockSimulation: sim };
});

vi.mock('d3-force', () => ({
  forceSimulation: vi.fn(() => mockSimulation),
  forceCollide: vi.fn(() => {
    const fn = vi.fn();
    fn.mockReturnValue({ strength: vi.fn().mockReturnValue(fn) });
    return fn();
  }),
  forceManyBody: vi.fn(() => {
    const fn: any = { strength: vi.fn().mockReturnThis(), distanceMax: vi.fn().mockReturnThis() };
    return fn;
  }),
  forceLink: vi.fn(() => {
    const fn: any = { distance: vi.fn().mockReturnThis(), strength: vi.fn().mockReturnThis() };
    return fn;
  }),
  forceX: vi.fn(() => {
    const fn: any = { strength: vi.fn().mockReturnThis() };
    return fn;
  }),
  forceY: vi.fn(() => {
    const fn: any = { strength: vi.fn().mockReturnThis() };
    return fn;
  }),
}));

import { useForceSimulation, type ForceSimulationInput } from './use-force-simulation';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset simulation mock chain
  mockSimulation.force.mockReturnThis();
  mockSimulation.alphaDecay.mockReturnThis();
  mockSimulation.velocityDecay.mockReturnThis();
  mockSimulation.alpha.mockReturnThis();
  mockSimulation.stop.mockReturnThis();
  mockSimulation.restart.mockReturnThis();
  mockSimulation.on.mockReturnThis();
});

describe('useForceSimulation', () => {
  const defaultNodes = [
    { id: 'group-A', x: 0, y: 0, width: 300, height: 200 },
    { id: 'group-B', x: 400, y: 0, width: 300, height: 200 },
    { id: 'net-ext', x: 200, y: 300, width: 140, height: 90 },
  ];

  const defaultLinks = [
    { id: 'link-1', source: 'group-A', target: 'net-ext' },
    { id: 'link-2', source: 'group-B', target: 'net-ext' },
  ];

  it('returns drag handler functions', () => {
    const onTick = vi.fn();
    const { result } = renderHook(() =>
      useForceSimulation({ nodes: defaultNodes, links: defaultLinks, onTick }),
    );

    expect(result.current.onNodeDragStart).toBeTypeOf('function');
    expect(result.current.onNodeDrag).toBeTypeOf('function');
    expect(result.current.onNodeDragStop).toBeTypeOf('function');
  });

  it('creates simulation with alpha=0 and stopped for non-empty nodes', () => {
    const onTick = vi.fn();
    renderHook(() =>
      useForceSimulation({ nodes: defaultNodes, links: defaultLinks, onTick }),
    );

    // Simulation should be created stopped (alpha 0, then stop)
    expect(mockSimulation.alpha).toHaveBeenCalledWith(0);
    expect(mockSimulation.stop).toHaveBeenCalled();
  });

  it('does not create simulation for empty nodes', async () => {
    const { forceSimulation } = vi.mocked(await import('d3-force'));
    (forceSimulation as ReturnType<typeof vi.fn>).mockClear();

    const onTick = vi.fn();
    renderHook(() =>
      useForceSimulation({ nodes: [], links: [], onTick }),
    );

    expect(forceSimulation).not.toHaveBeenCalled();
  });

  it('restarts simulation with alpha on drag start', () => {
    const onTick = vi.fn();
    const { result } = renderHook(() =>
      useForceSimulation({ nodes: defaultNodes, links: defaultLinks, onTick }),
    );

    // Reset to track drag-specific calls
    mockSimulation.alpha.mockClear();
    mockSimulation.restart.mockClear();

    act(() => {
      result.current.onNodeDragStart({} as React.MouseEvent, 'group-A');
    });

    expect(mockSimulation.alpha).toHaveBeenCalledWith(0.3);
    expect(mockSimulation.restart).toHaveBeenCalled();
  });

  it('stops simulation on cleanup', () => {
    const onTick = vi.fn();
    const { unmount } = renderHook(() =>
      useForceSimulation({ nodes: defaultNodes, links: defaultLinks, onTick }),
    );

    mockSimulation.stop.mockClear();
    unmount();

    expect(mockSimulation.stop).toHaveBeenCalled();
  });

  it('registers a tick handler', () => {
    const onTick = vi.fn();
    renderHook(() =>
      useForceSimulation({ nodes: defaultNodes, links: defaultLinks, onTick }),
    );

    expect(mockSimulation.on).toHaveBeenCalledWith('tick', expect.any(Function));
  });

  it('configures forces: collide, charge, link, x, y', () => {
    const onTick = vi.fn();
    renderHook(() =>
      useForceSimulation({ nodes: defaultNodes, links: defaultLinks, onTick }),
    );

    const forceNames = mockSimulation.force.mock.calls.map((call: unknown[]) => call[0]);
    expect(forceNames).toContain('collide');
    expect(forceNames).toContain('charge');
    expect(forceNames).toContain('link');
    expect(forceNames).toContain('x');
    expect(forceNames).toContain('y');
  });
});
