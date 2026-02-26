import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useURLState } from './use-url-state';

// Mock react-router-dom
const mockSetSearchParams = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

describe('useURLState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('returns default value when key is not in URL', () => {
    const { result } = renderHook(() => useURLState('status', 'all'));
    expect(result.current[0]).toBe('all');
  });

  it('returns URL value when key exists in search params', () => {
    mockSearchParams = new URLSearchParams('status=running');
    const { result } = renderHook(() => useURLState('status', 'all'));
    expect(result.current[0]).toBe('running');
  });

  it('calls setSearchParams with new value', () => {
    const { result } = renderHook(() => useURLState('sort', 'name-asc'));

    act(() => {
      result.current[1]('cpu-desc');
    });

    expect(mockSetSearchParams).toHaveBeenCalledWith(
      expect.any(Function),
      { replace: true }
    );

    // Execute the updater function to verify behavior
    const updaterFn = mockSetSearchParams.mock.calls[0][0];
    const updatedParams = updaterFn(new URLSearchParams());
    expect(updatedParams.get('sort')).toBe('cpu-desc');
  });

  it('removes key when value equals default', () => {
    mockSearchParams = new URLSearchParams('sort=cpu-desc');
    const { result } = renderHook(() => useURLState('sort', 'name-asc'));

    act(() => {
      result.current[1]('name-asc');
    });

    const updaterFn = mockSetSearchParams.mock.calls[0][0];
    const updatedParams = updaterFn(new URLSearchParams('sort=cpu-desc'));
    expect(updatedParams.has('sort')).toBe(false);
  });

  it('removes key when value is empty string', () => {
    mockSearchParams = new URLSearchParams('search=nginx');
    const { result } = renderHook(() => useURLState('search', ''));

    act(() => {
      result.current[1]('');
    });

    const updaterFn = mockSetSearchParams.mock.calls[0][0];
    const updatedParams = updaterFn(new URLSearchParams('search=nginx'));
    expect(updatedParams.has('search')).toBe(false);
  });

  it('preserves other URL params when setting a value', () => {
    const { result } = renderHook(() => useURLState('view', 'table'));

    act(() => {
      result.current[1]('grid');
    });

    const updaterFn = mockSetSearchParams.mock.calls[0][0];
    const existing = new URLSearchParams('status=running&timeRange=24h');
    const updatedParams = updaterFn(existing);
    expect(updatedParams.get('view')).toBe('grid');
    expect(updatedParams.get('status')).toBe('running');
    expect(updatedParams.get('timeRange')).toBe('24h');
  });
});
