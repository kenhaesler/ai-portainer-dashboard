import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  useMarkFalsePositive,
  useAnomalyFeedbackRates,
  deriveCorrelatedAnomalyId,
} from './use-anomaly-feedback';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('use-anomaly-feedback hooks (#1298)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── deriveCorrelatedAnomalyId ──────────────────────────────────

  describe('deriveCorrelatedAnomalyId', () => {
    it('returns a stable id derived from (containerId, timestamp)', () => {
      const id = deriveCorrelatedAnomalyId({
        containerId: 'abc123',
        timestamp: '2025-01-01T12:00:00Z',
      });
      expect(id).toBe('correlated:abc123:2025-01-01T12:00:00Z');
    });

    it('produces distinct ids for distinct timestamps on the same container', () => {
      const id1 = deriveCorrelatedAnomalyId({
        containerId: 'abc123',
        timestamp: '2025-01-01T12:00:00Z',
      });
      const id2 = deriveCorrelatedAnomalyId({
        containerId: 'abc123',
        timestamp: '2025-01-01T13:00:00Z',
      });
      expect(id1).not.toBe(id2);
    });
  });

  // ── useMarkFalsePositive ───────────────────────────────────────

  describe('useMarkFalsePositive', () => {
    it('POSTs to /api/monitoring/anomaly-feedback with disposition=false-positive', async () => {
      mockApiPost.mockResolvedValue({
        success: true,
        anomalyId: 'correlated:c1:t1',
        disposition: 'false-positive',
        duplicate: false,
      });

      const { result } = renderHook(() => useMarkFalsePositive(), { wrapper: createWrapper() });

      result.current.mutate({ anomalyId: 'correlated:c1:t1', detector: 'correlated-zscore' });

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/api/monitoring/anomaly-feedback',
          expect.objectContaining({
            anomalyId: 'correlated:c1:t1',
            disposition: 'false-positive',
            detector: 'correlated-zscore',
          }),
        );
      });
    });

    it('omits detector field when not provided', async () => {
      mockApiPost.mockResolvedValue({
        success: true,
        anomalyId: 'insight-1',
        disposition: 'false-positive',
        duplicate: false,
      });

      const { result } = renderHook(() => useMarkFalsePositive(), { wrapper: createWrapper() });

      result.current.mutate({ anomalyId: 'insight-1' });

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledTimes(1);
      });
      const body = mockApiPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('detector');
      expect(body.disposition).toBe('false-positive');
    });

    it('invokes onOptimisticDismiss synchronously and not onRevertDismiss on success', async () => {
      mockApiPost.mockResolvedValue({
        success: true,
        anomalyId: 'a-1',
        disposition: 'false-positive',
        duplicate: false,
      });

      const onOptimisticDismiss = vi.fn();
      const onRevertDismiss = vi.fn();

      const { result } = renderHook(
        () => useMarkFalsePositive({ onOptimisticDismiss, onRevertDismiss }),
        { wrapper: createWrapper() },
      );

      result.current.mutate({ anomalyId: 'a-1' });

      await waitFor(() => {
        expect(onOptimisticDismiss).toHaveBeenCalledWith('a-1');
      });

      // Wait for the mutation to settle and verify revert was NOT called.
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(onRevertDismiss).not.toHaveBeenCalled();
    });

    it('reverts the optimistic dismissal on network error', async () => {
      mockApiPost.mockRejectedValue(new Error('boom'));

      const onOptimisticDismiss = vi.fn();
      const onRevertDismiss = vi.fn();

      const { result } = renderHook(
        () => useMarkFalsePositive({ onOptimisticDismiss, onRevertDismiss }),
        { wrapper: createWrapper() },
      );

      result.current.mutate({ anomalyId: 'a-2' });

      await waitFor(() => {
        expect(onOptimisticDismiss).toHaveBeenCalledWith('a-2');
      });
      await waitFor(() => {
        expect(onRevertDismiss).toHaveBeenCalledWith('a-2');
      });
    });
  });

  // ── useAnomalyFeedbackRates ────────────────────────────────────

  describe('useAnomalyFeedbackRates', () => {
    it('GETs /api/monitoring/anomaly-feedback/rates with no scope param by default', async () => {
      mockApiGet.mockResolvedValue({ rates: [], scope: 'mine' });

      const { result } = renderHook(() => useAnomalyFeedbackRates(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/monitoring/anomaly-feedback/rates',
        expect.objectContaining({ params: undefined }),
      );
      expect(result.current.data?.scope).toBe('mine');
    });

    it('passes scope=mine query when caller explicitly opts in', async () => {
      mockApiGet.mockResolvedValue({ rates: [], scope: 'mine' });

      const { result } = renderHook(() => useAnomalyFeedbackRates('mine'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/monitoring/anomaly-feedback/rates',
        expect.objectContaining({ params: { scope: 'mine' } }),
      );
    });

    it('returns per-detector rate data unchanged from the server', async () => {
      mockApiGet.mockResolvedValue({
        rates: [
          { detector: 'threshold', anomalies: 10, falsePositives: 2, rate: 0.2 },
          { detector: 'ml-anomaly', anomalies: 5, falsePositives: 0, rate: 0 },
        ],
        scope: 'fleet',
      });

      const { result } = renderHook(() => useAnomalyFeedbackRates(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.rates).toHaveLength(2);
      expect(result.current.data?.rates[0].rate).toBeCloseTo(0.2);
      expect(result.current.data?.rates[1].rate).toBe(0);
    });
  });
});
