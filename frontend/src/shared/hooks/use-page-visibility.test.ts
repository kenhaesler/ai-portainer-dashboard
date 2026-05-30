import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePageVisibility } from './use-page-visibility';

describe('usePageVisibility', () => {
  it('returns true when page is visible', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);
  });

  it('returns false when page becomes hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current).toBe(false);
  });
});
