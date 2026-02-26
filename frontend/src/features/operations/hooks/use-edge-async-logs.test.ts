import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEdgeAsyncLogs } from './use-edge-async-logs';

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import { api } from '@/lib/api';

const mockApi = vi.mocked(api);

describe('useEdgeAsyncLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useEdgeAsyncLogs(7, 'abc123'));
    expect(result.current.status).toBe('idle');
    expect(result.current.logs).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions idle → initiating → collecting → complete', async () => {
    mockApi.post.mockResolvedValue({ jobId: 42, status: 'collecting' });
    mockApi.get.mockResolvedValue({
      logs: 'collected output\n',
      containerId: 'abc123',
      endpointId: 7,
      durationMs: 15000,
      source: 'edge-job',
    });

    const { result } = renderHook(() => useEdgeAsyncLogs(7, 'abc123'));

    // Trigger collection
    await act(async () => {
      result.current.collect({ tail: 100 });
    });

    // After POST resolves, should be 'collecting'
    expect(result.current.status).toBe('collecting');

    // Advance timer to trigger first poll (async-aware)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.status).toBe('complete');
    expect(result.current.logs).toBe('collected output\n');
    expect(result.current.durationMs).toBe(15000);
  });

  it('sets error state on initiation failure', async () => {
    mockApi.post.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useEdgeAsyncLogs(7, 'abc123'));

    await act(async () => {
      result.current.collect();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Network error');
  });

  it('sets error on poll failure', async () => {
    mockApi.post.mockResolvedValue({ jobId: 42, status: 'collecting' });
    mockApi.get.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useEdgeAsyncLogs(7, 'abc123'));

    await act(async () => {
      result.current.collect();
    });

    expect(result.current.status).toBe('collecting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Server error');
  });

  it('reset returns to idle', async () => {
    mockApi.post.mockResolvedValue({ jobId: 42, status: 'collecting' });

    const { result } = renderHook(() => useEdgeAsyncLogs(7, 'abc123'));

    await act(async () => {
      result.current.collect();
    });

    expect(result.current.status).toBe('collecting');

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.logs).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
