import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMinimumSpin } from './use-minimum-spin';

describe('useMinimumSpin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spins immediately while loading', () => {
    const { result } = renderHook(({ loading }) => useMinimumSpin(loading), {
      initialProps: { loading: true },
    });
    expect(result.current).toBe(true);
  });

  it('keeps spinning for the minimum duration after loading ends, then stops', () => {
    const { result, rerender } = renderHook(({ loading }) => useMinimumSpin(loading), {
      initialProps: { loading: true },
    });
    expect(result.current).toBe(true);

    // Loading ends almost immediately — spin must persist for the floor.
    rerender({ loading: false });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
  });

  it('does not spin when never loading', () => {
    const { result } = renderHook(() => useMinimumSpin(false));
    expect(result.current).toBe(false);
  });
});
