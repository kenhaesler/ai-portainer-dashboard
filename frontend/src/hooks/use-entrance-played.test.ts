import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEntrancePlayed } from './use-entrance-played';

describe('useEntrancePlayed', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('should return hasPlayed=false on first visit', () => {
    const { result } = renderHook(() => useEntrancePlayed());
    expect(result.current.hasPlayed).toBe(false);
  });

  it('should return hasPlayed=true after markPlayed is called', () => {
    const { result } = renderHook(() => useEntrancePlayed());

    act(() => {
      result.current.markPlayed();
    });

    expect(result.current.hasPlayed).toBe(true);
  });

  it('should persist to sessionStorage', () => {
    const { result } = renderHook(() => useEntrancePlayed());

    act(() => {
      result.current.markPlayed();
    });

    expect(sessionStorage.getItem('dashboard-entrance-played')).toBe('true');
  });

  it('should return hasPlayed=true when sessionStorage already set', () => {
    sessionStorage.setItem('dashboard-entrance-played', 'true');

    const { result } = renderHook(() => useEntrancePlayed());
    expect(result.current.hasPlayed).toBe(true);
  });

  it('should return stable markPlayed reference', () => {
    const { result, rerender } = renderHook(() => useEntrancePlayed());
    const firstRef = result.current.markPlayed;

    rerender();

    expect(result.current.markPlayed).toBe(firstRef);
  });
});
