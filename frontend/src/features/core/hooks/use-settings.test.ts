import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    get: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}));

import { useUpdateSetting, useDeleteSetting } from './use-settings';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useUpdateSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends category when provided and shows success toast only after mutation success', async () => {
    const deferred = createDeferred<void>();
    mockPut.mockReturnValueOnce(deferred.promise);

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateSetting(), { wrapper: createWrapper(queryClient) });

    act(() => {
      result.current.mutate({
        key: 'monitoring.enabled',
        value: 'false',
        category: 'monitoring',
      });
    });

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/api/settings/monitoring.enabled', {
        value: 'false',
        category: 'monitoring',
      });
    });
    expect(mockSuccess).not.toHaveBeenCalled();

    deferred.resolve();

    await waitFor(() => {
      expect(mockSuccess).toHaveBeenCalledWith('Setting saved', {
        description: '"monitoring.enabled" updated.',
      });
    });
  });

  it('omits category from payload when not provided', async () => {
    mockPut.mockResolvedValueOnce(undefined);

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateSetting(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ key: 'custom.key', value: 'abc' });
    });

    expect(mockPut).toHaveBeenCalledWith('/api/settings/custom.key', { value: 'abc' });
  });

  it('rolls back category-scoped settings cache on mutation failure', async () => {
    const deferred = createDeferred<void>();
    mockPut.mockReturnValueOnce(deferred.promise);

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(['settings', 'monitoring'], [
      {
        key: 'monitoring.enabled',
        value: 'true',
        category: 'monitoring',
        label: 'Enable Monitoring',
        type: 'boolean',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() => useUpdateSetting(), { wrapper: createWrapper(queryClient) });

    act(() => {
      result.current.mutate({ key: 'monitoring.enabled', value: 'false' });
    });

    await waitFor(() => {
      const optimisticData = queryClient.getQueryData<Array<{ value: string }>>(['settings', 'monitoring']);
      expect(optimisticData?.[0]?.value).toBe('false');
    });

    deferred.reject(new Error('update failed'));

    await waitFor(() => {
      expect(mockError).toHaveBeenCalledWith('Failed to save "monitoring.enabled"', {
        description: 'update failed',
      });
    });

    const rolledBackData = queryClient.getQueryData<Array<{ value: string }>>(['settings', 'monitoring']);
    expect(rolledBackData?.[0]?.value).toBe('true');
  });
});

describe('useDeleteSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls DELETE endpoint and shows success toast', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useDeleteSetting(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ key: 'prompts.chat_assistant.system_prompt' });
    });

    expect(mockDelete).toHaveBeenCalledWith('/api/settings/prompts.chat_assistant.system_prompt');
    expect(mockSuccess).toHaveBeenCalledWith('Setting reset', {
      description: '"prompts.chat_assistant.system_prompt" removed.',
    });
  });

  it('suppresses toast when showToast is false', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useDeleteSetting(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ key: 'prompts.chat_assistant.model', showToast: false });
    });

    expect(mockDelete).toHaveBeenCalledWith('/api/settings/prompts.chat_assistant.model');
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    mockDelete.mockRejectedValueOnce(new Error('delete failed'));

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useDeleteSetting(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      try {
        await result.current.mutateAsync({ key: 'prompts.chat_assistant.system_prompt' });
      } catch {
        // expected
      }
    });

    expect(mockError).toHaveBeenCalledWith('Failed to reset "prompts.chat_assistant.system_prompt"', {
      description: 'delete failed',
    });
  });
});
