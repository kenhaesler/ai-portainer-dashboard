import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  useRemediationActions,
  useApproveAction,
  useRejectAction,
  useExecuteAction,
} from './use-remediation';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
import { toast } from 'sonner';

const mockApi = vi.mocked(api);
const mockToast = vi.mocked(toast);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        refetchOnWindowFocus: true,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useRemediationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not retry on 429-style errors', async () => {
    mockApi.get.mockRejectedValue(new Error('Too Many Requests'));

    const { result } = renderHook(() => useRemediationActions('pending'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  it('sends status filter to remediation actions endpoint', async () => {
    mockApi.get.mockResolvedValue([]);

    const { result } = renderHook(() => useRemediationActions('pending'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/remediation/actions', {
      params: { status: 'pending' },
    });
  });
});

describe('remediation mutations — toasts name the action, not the UUID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.post.mockResolvedValue(undefined as never);
  });

  it('approve quotes the human label and says nothing runs yet', async () => {
    const { result } = renderHook(() => useApproveAction(), { wrapper: createWrapper() });

    result.current.mutate({ actionId: '3f2b8c1e-uuid', label: 'Stop Container on api-service' });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    const [title, opts] = mockToast.success.mock.calls[0];
    expect(title).toBe('Action approved');
    expect(opts?.description).toBe(
      'Stop Container on api-service is approved. Nothing runs until you press Execute.',
    );
    expect(opts?.description).not.toContain('3f2b8c1e-uuid');
  });

  it('reject sends the operator reason as the request body', async () => {
    const { result } = renderHook(() => useRejectAction(), { wrapper: createWrapper() });

    result.current.mutate({
      actionId: 'a1',
      label: 'Stop Container on api-service',
      reason: '  Nightly import still running  ',
    });

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/remediation/actions/a1/reject',
      { reason: 'Nightly import still running' },
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(mockToast.success.mock.calls[0][1]?.description).toContain('Nightly import still running');
  });

  it('reject with a blank reason posts an empty body rather than an empty string', async () => {
    const { result } = renderHook(() => useRejectAction(), { wrapper: createWrapper() });

    result.current.mutate({ actionId: 'a1', label: 'Stop Container on api-service', reason: '   ' });

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(mockApi.post).toHaveBeenCalledWith('/api/remediation/actions/a1/reject', {});
  });

  it('execute quotes the human label', async () => {
    const { result } = renderHook(() => useExecuteAction(), { wrapper: createWrapper() });

    result.current.mutate({ actionId: 'a1', label: 'Restart Container on lcm-server' });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(mockToast.success.mock.calls[0][1]?.description).toBe(
      'Restart Container on lcm-server has run. The row shows the result.',
    );
  });
});
