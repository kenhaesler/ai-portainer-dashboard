import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from './use-count-up';

function stubMatchMedia(reduceMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reduceMotion : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('useCountUp', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start at 0 initially', () => {
    const { result } = renderHook(() => useCountUp(100));
    // Initial state before any animation frame
    expect(result.current).toBe(0);
  });

  it('should reach target value after animation completes', async () => {
    const { result } = renderHook(() => useCountUp(50));

    // Advance past the animation duration (1200ms default)
    act(() => {
      vi.advanceTimersByTime(1300);
    });

    expect(result.current).toBe(50);
  });

  it('should return target immediately when disabled', () => {
    const { result } = renderHook(() => useCountUp(42, { enabled: false }));
    expect(result.current).toBe(42);
  });

  it('should return target immediately with reduced motion', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
  });

  it('should animate delta when target changes', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target),
      { initialProps: { target: 50 } },
    );

    // Complete first animation
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(result.current).toBe(50);

    // Change target
    rerender({ target: 60 });

    // After completing the second animation
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(result.current).toBe(60);
  });

  it('should handle target of 0', () => {
    const { result } = renderHook(() => useCountUp(0));
    expect(result.current).toBe(0);
  });

  it('should accept custom duration', () => {
    const { result } = renderHook(() => useCountUp(100, { duration: 500 }));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current).toBe(100);
  });
});
