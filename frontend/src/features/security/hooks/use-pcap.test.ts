import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    getToken: vi.fn().mockReturnValue('test-token'),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
import { useCaptures, useCapture, useStartCapture, useStopCapture, useDeleteCapture, useAnalyzeCapture } from './use-pcap';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('use-pcap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useCaptures', () => {
    it('should fetch captures list', async () => {
      const mockResponse = {
        captures: [
          { id: 'c1', status: 'complete', container_name: 'web' },
          { id: 'c2', status: 'capturing', container_name: 'api' },
        ],
      };
      mockApi.get.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useCaptures(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.captures).toHaveLength(2);
      expect(mockApi.get).toHaveBeenCalledWith('/api/pcap/captures', {
        params: { status: undefined, containerId: undefined },
      });
    });

    it('should pass status filter', async () => {
      mockApi.get.mockResolvedValue({ captures: [] });

      const { result } = renderHook(() => useCaptures({ status: 'complete' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockApi.get).toHaveBeenCalledWith('/api/pcap/captures', {
        params: { status: 'complete', containerId: undefined },
      });
    });
  });

  describe('useCapture', () => {
    it('should fetch single capture', async () => {
      const mockCapture = { id: 'c1', status: 'complete' };
      mockApi.get.mockResolvedValue(mockCapture);

      const { result } = renderHook(() => useCapture('c1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe('c1');
    });

    it('should not fetch when id is undefined', () => {
      renderHook(() => useCapture(undefined), {
        wrapper: createWrapper(),
      });

      expect(mockApi.get).not.toHaveBeenCalled();
    });
  });

  describe('useStartCapture', () => {
    it('should call POST to start capture', async () => {
      const mockCapture = { id: 'c1', status: 'capturing', container_name: 'web' };
      mockApi.post.mockResolvedValue(mockCapture);

      const { result } = renderHook(() => useStartCapture(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'web',
        filter: 'port 80',
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockApi.post).toHaveBeenCalledWith('/api/pcap/captures', {
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'web',
        filter: 'port 80',
      });
    });
  });

  describe('useStopCapture', () => {
    it('should call POST to stop capture', async () => {
      mockApi.post.mockResolvedValue({ id: 'c1', status: 'succeeded' });

      const { result } = renderHook(() => useStopCapture(), {
        wrapper: createWrapper(),
      });

      result.current.mutate('c1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockApi.post).toHaveBeenCalledWith('/api/pcap/captures/c1/stop');
    });
  });

  describe('useDeleteCapture', () => {
    it('should call DELETE to remove capture', async () => {
      mockApi.delete.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteCapture(), {
        wrapper: createWrapper(),
      });

      result.current.mutate('c1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockApi.delete).toHaveBeenCalledWith('/api/pcap/captures/c1');
    });
  });

  describe('useAnalyzeCapture', () => {
    it('should call POST to analyze capture', async () => {
      const mockResult = {
        health_status: 'healthy',
        summary: 'Normal traffic',
        findings: [],
        confidence_score: 0.9,
      };
      mockApi.post.mockResolvedValue(mockResult);

      const { result } = renderHook(() => useAnalyzeCapture(), {
        wrapper: createWrapper(),
      });

      result.current.mutate('c1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockApi.post).toHaveBeenCalledWith('/api/pcap/captures/c1/analyze');
      expect(result.current.data?.health_status).toBe('healthy');
    });
  });
});
