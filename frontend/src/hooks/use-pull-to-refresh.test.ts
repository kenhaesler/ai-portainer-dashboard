import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePullToRefresh } from './use-pull-to-refresh';

describe('usePullToRefresh', () => {
  it('initializes with zero pull distance and not refreshing', () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh }),
    );
    expect(result.current.pullDistance).toBe(0);
    expect(result.current.isRefreshing).toBe(false);
  });

  it('does not refresh when disabled', () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, disabled: true }),
    );
    expect(result.current.pullDistance).toBe(0);
    expect(result.current.isRefreshing).toBe(false);
  });

  it('responds to touch events for pull-to-refresh', async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 50 }),
    );

    // Simulate touch start at top of page
    Object.defineProperty(document.documentElement, 'scrollTop', { value: 0, writable: true });

    await act(async () => {
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientY: 100 } as Touch],
      });
      document.dispatchEvent(touchStartEvent);
    });

    await act(async () => {
      const touchMoveEvent = new TouchEvent('touchmove', {
        touches: [{ clientY: 300 } as Touch],
      });
      document.dispatchEvent(touchMoveEvent);
    });

    // Pull distance should be > 0 after pulling down
    expect(result.current.pullDistance).toBeGreaterThan(0);
  });
});
