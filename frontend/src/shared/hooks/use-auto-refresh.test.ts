import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutoRefresh } from './use-auto-refresh';

const SHARED_KEY = 'ai-portainer-auto-refresh';

describe('useAutoRefresh', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  describe('state (unchanged contract)', () => {
    it('starts at the requested default and derives enabled from it', () => {
      const { result } = renderHook(() => useAutoRefresh(30));
      expect(result.current.interval).toBe(30);
      expect(result.current.enabled).toBe(true);
    });

    it('treats an interval of 0 as disabled', () => {
      const { result } = renderHook(() => useAutoRefresh(0));
      expect(result.current.interval).toBe(0);
      expect(result.current.enabled).toBe(false);
    });

    it('persists the interval and rehydrates it', () => {
      const { result } = renderHook(() => useAutoRefresh(30));
      act(() => result.current.setRefreshInterval(60));
      expect(JSON.parse(window.localStorage.getItem(SHARED_KEY)!)).toEqual({
        interval: 60,
        enabled: true,
      });

      const second = renderHook(() => useAutoRefresh(30));
      expect(second.result.current.interval).toBe(60);
    });

    it('exposes the valid interval options', () => {
      const { result } = renderHook(() => useAutoRefresh(30));
      expect(result.current.options).toEqual([0, 15, 30, 60, 120, 300]);
    });

    it('toggle() flips enabled, but never enables a 0 interval', () => {
      const { result } = renderHook(() => useAutoRefresh(30));
      act(() => result.current.toggle());
      expect(result.current.enabled).toBe(false);

      act(() => result.current.setRefreshInterval(0));
      act(() => result.current.toggle());
      expect(result.current.enabled).toBe(false);
    });
  });

  describe('setInterval alias', () => {
    // Existing call sites destructure `setInterval` (which shadows
    // window.setInterval in the consuming module — the very reason hand-wiring
    // the timer was error-prone). The alias keeps them compiling.
    it('is the same function as setRefreshInterval', () => {
      const { result } = renderHook(() => useAutoRefresh(30));
      expect(result.current.setInterval).toBe(result.current.setRefreshInterval);
    });

    it('still updates the interval', () => {
      const { result } = renderHook(() => useAutoRefresh(30));
      act(() => result.current.setInterval(15));
      expect(result.current.interval).toBe(15);
    });
  });

  describe('scheduling (the hook owns the timer)', () => {
    it('calls onTick once per interval while enabled', () => {
      const onTick = vi.fn();
      renderHook(() => useAutoRefresh(30, { onTick }));

      expect(onTick).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(30_000));
      expect(onTick).toHaveBeenCalledTimes(1);
      act(() => void vi.advanceTimersByTime(60_000));
      expect(onTick).toHaveBeenCalledTimes(3);
    });

    it('does not schedule anything when the interval is 0', () => {
      const onTick = vi.fn();
      renderHook(() => useAutoRefresh(0, { onTick }));
      act(() => void vi.advanceTimersByTime(10 * 60_000));
      expect(onTick).not.toHaveBeenCalled();
    });

    it('re-arms at the new cadence when the dropdown changes', () => {
      const onTick = vi.fn();
      const { result } = renderHook(() => useAutoRefresh(30, { onTick }));

      act(() => result.current.setRefreshInterval(15));
      act(() => void vi.advanceTimersByTime(15_000));
      expect(onTick).toHaveBeenCalledTimes(1);

      // The old 30s timer must be gone, not merely superseded.
      onTick.mockClear();
      act(() => result.current.setRefreshInterval(0));
      act(() => void vi.advanceTimersByTime(5 * 60_000));
      expect(onTick).not.toHaveBeenCalled();
    });

    it('stops ticking when toggled off and resumes when toggled on', () => {
      const onTick = vi.fn();
      const { result } = renderHook(() => useAutoRefresh(15, { onTick }));

      act(() => result.current.toggle());
      act(() => void vi.advanceTimersByTime(60_000));
      expect(onTick).not.toHaveBeenCalled();

      act(() => result.current.toggle());
      act(() => void vi.advanceTimersByTime(15_000));
      expect(onTick).toHaveBeenCalledTimes(1);
    });

    it('clears the timer on unmount', () => {
      const onTick = vi.fn();
      const { unmount } = renderHook(() => useAutoRefresh(15, { onTick }));
      unmount();
      act(() => void vi.advanceTimersByTime(60_000));
      expect(onTick).not.toHaveBeenCalled();
    });

    it('does not restart the timer when the callback identity changes', () => {
      // Consumers pass inline arrows; a new function every render must not
      // reset the countdown, or a frequently-rendering page would never tick.
      const spy = vi.fn();
      const { rerender } = renderHook(() => useAutoRefresh(30, { onTick: () => spy() }));

      act(() => void vi.advanceTimersByTime(20_000));
      rerender();
      rerender();
      act(() => void vi.advanceTimersByTime(10_000));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('calls the latest callback, not the one captured at mount', () => {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderHook(
        ({ cb }: { cb: () => void }) => useAutoRefresh(30, { onTick: cb }),
        { initialProps: { cb: first } },
      );

      rerender({ cb: second });
      act(() => void vi.advanceTimersByTime(30_000));
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('is inert for consumers that pass no callback', () => {
      // The 20-odd existing call sites read `interval` and drive react-query
      // themselves; they must not gain a second refresh path.
      expect(() => {
        renderHook(() => useAutoRefresh(15));
        act(() => void vi.advanceTimersByTime(60_000));
      }).not.toThrow();
    });
  });

  describe('storageKey', () => {
    it('defaults to the shared key so existing consumers keep their stored cadence', () => {
      const { result } = renderHook(() => useAutoRefresh(30));
      act(() => result.current.setRefreshInterval(120));
      expect(window.localStorage.getItem(SHARED_KEY)).not.toBeNull();
    });

    it('scopes persistence per page when supplied, so one page cannot show another page cadence', () => {
      const shared = renderHook(() => useAutoRefresh(30));
      act(() => shared.result.current.setRefreshInterval(30));

      // A page that asks for "off" must open showing off, not the 30s another
      // page happened to store under the shared key.
      const scoped = renderHook(() => useAutoRefresh(0, { storageKey: 'metrics' }));
      expect(scoped.result.current.interval).toBe(0);
      expect(scoped.result.current.enabled).toBe(false);

      act(() => scoped.result.current.setRefreshInterval(15));
      expect(JSON.parse(window.localStorage.getItem(`${SHARED_KEY}:metrics`)!).interval).toBe(15);
      expect(JSON.parse(window.localStorage.getItem(SHARED_KEY)!).interval).toBe(30);
    });
  });

  describe('persistence records choices, not defaults', () => {
    it('writes nothing on mount', () => {
      renderHook(() => useAutoRefresh(30));
      expect(window.localStorage.getItem(SHARED_KEY)).toBeNull();

      renderHook(() => useAutoRefresh(60, { storageKey: 'images' }));
      expect(window.localStorage.getItem(`${SHARED_KEY}:images`)).toBeNull();
    });

    it('does not let one page seed the shared cadence for every other page', () => {
      // Image Footprint asks for 60s on the SHARED key while the dashboards ask
      // for 30s. Mounting it used to write 60, silently slowing every dashboard
      // query elsewhere in the app.
      renderHook(() => useAutoRefresh(60));

      const dashboard = renderHook(() => useAutoRefresh(30));
      expect(dashboard.result.current.interval).toBe(30);
    });

    it('persists a re-selection of the value already shown', () => {
      // Guards against "fix" by value-comparison: picking 30 when 30 is already
      // displayed is still the user making a choice, and it must be recorded.
      const { result } = renderHook(() => useAutoRefresh(30));
      act(() => result.current.setRefreshInterval(30));
      expect(JSON.parse(window.localStorage.getItem(SHARED_KEY)!).interval).toBe(30);
    });

    it('rehydrates a stored cadence without rewriting it', () => {
      window.localStorage.setItem(SHARED_KEY, JSON.stringify({ interval: 120, enabled: true }));
      const { result } = renderHook(() => useAutoRefresh(30));

      expect(result.current.interval).toBe(120);
      expect(JSON.parse(window.localStorage.getItem(SHARED_KEY)!).interval).toBe(120);
    });
  });
});
